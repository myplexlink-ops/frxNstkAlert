/* Trading Alerts — vanilla frontend */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var state = { me: null, alerts: [], watchlist: [] };

  /* ---------- Netlify Identity ---------- */
  var identity = window.netlifyIdentity;

  function token() {
    return new Promise(function (resolve) {
      var u = identity.currentUser();
      if (!u) return resolve(null);
      u.jwt().then(resolve).catch(function () { resolve(null); });
    });
  }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    return token().then(function (tok) {
      var headers = { 'Content-Type': 'application/json' };
      if (tok) headers.Authorization = 'Bearer ' + tok;
      return fetch('/api/' + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
          return data;
        });
      });
    });
  }

  /* ---------- UI helpers ---------- */
  var toastTimer;
  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast hidden'; }, 3500);
  }

  function show(view) {
    $$('.view').forEach(function (v) { v.classList.add('hidden'); });
    var el = $('#view-' + view);
    if (el) el.classList.remove('hidden');
    $$('.nav-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  function fmtCondition(a) {
    if (a.condition_type === 'cross_above') return 'crosses above ' + a.target_value;
    if (a.condition_type === 'cross_below') return 'crosses below ' + a.target_value;
    return '% change reaches ' + a.target_value + '%' +
      (a.reference_price ? ' (ref ' + a.reference_price + ')' : '');
  }

  /* ---------- Bootstrap / routing ---------- */
  function bootstrap() {
    var u = identity.currentUser();
    if (!u) {
      stopTriggerWatch();
      $('#nav').classList.add('hidden');
      $('#btn-login').classList.remove('hidden');
      $('#btn-logout').classList.add('hidden');
      $('#user-email').textContent = '';
      show('landing');
      return;
    }
    $('#btn-login').classList.add('hidden');
    $('#btn-logout').classList.remove('hidden');
    $('#user-email').textContent = u.email;

    return api('me').then(function (me) {
      state.me = me;
      if (!me.approved && !me.is_admin) {
        stopTriggerWatch();
        $('#nav').classList.add('hidden');
        $('#pending-email').textContent = me.email;
        show('pending');
        return;
      }
      $('#nav').classList.remove('hidden');
      $('#nav-admin').classList.toggle('hidden', !me.is_admin);
      show('dashboard');
      loadDashboard();
      loadWatchlist();
      startTriggerWatch();
    }).catch(function (e) {
      toast(e.message, 'err');
    });
  }

  /* ---------- Dashboard ---------- */
  function loadDashboard() {
    return api('list-alerts').then(function (d) {
      state.alerts = d.alerts || [];
      renderAlerts();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderAlerts() {
    var list = $('#alerts-list');
    list.innerHTML = '';
    $('#alerts-empty').classList.toggle('hidden', state.alerts.length > 0);

    state.alerts.forEach(function (a) {
      var row = document.createElement('div');
      row.className = 'row';

      var statusBadge = !a.active
        ? '<span class="badge fired">fired / inactive</span>'
        : (a.armed ? '<span class="badge ok">armed</span>' : '<span class="badge off">cooldown</span>');

      var price = a.cached_price != null
        ? ('<span class="price muted">last ' + a.cached_price +
           (a.cached_percent_change != null ? ' · ' + Number(a.cached_percent_change).toFixed(2) + '%' : '') +
           '</span>')
        : '<span class="price muted">no price yet</span>';

      row.innerHTML =
        '<span class="sym">' + a.symbol + '</span>' +
        '<span class="desc">' + fmtCondition(a) +
          ' · checked every ' + Math.round(a.poll_interval_seconds / 60) + ' min' +
          (a.recurring ? ' · recurring' : ' · one-time') + '</span>' +
        price +
        statusBadge +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-edit="' + a.id + '">Edit</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + a.id + '">Delete</button>';
      list.appendChild(row);
    });

    $$('[data-edit]').forEach(function (b) {
      b.onclick = function () { openModal(findAlert(b.dataset.edit)); };
    });
    $$('[data-del]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this alert?')) return;
        api('delete-alert', { method: 'DELETE', body: { id: b.dataset.del } })
          .then(function () { toast('Alert deleted', 'ok'); loadDashboard(); })
          .catch(function (e) { toast(e.message, 'err'); });
      };
    });
  }

  function findAlert(id) { return state.alerts.filter(function (a) { return a.id === id; })[0]; }

  /* ---------- Alert modal ---------- */
  function syncModalFields() {
    var cond = $('#f-condition').value;
    var isPct = cond === 'pct_change';
    $('#l-ref').classList.toggle('hidden', !isPct);
    $('#l-target').firstChild.textContent = isPct ? 'Target % change ' : 'Target price ';
  }

  function openModal(alert) {
    $('#form-error').classList.add('hidden');
    $('#modal-title').textContent = alert ? 'Edit alert' : 'New alert';
    $('#alert-id').value = alert ? alert.id : '';
    $('#f-asset-type').value = alert ? alert.asset_type : 'forex';
    $('#f-symbol').value = alert ? alert.symbol : '';
    $('#f-condition').value = alert ? alert.condition_type : 'cross_above';
    $('#f-target').value = alert ? alert.target_value : '';
    $('#f-ref').value = alert && alert.reference_price != null ? alert.reference_price : '';
    var mins = alert ? Math.round(alert.poll_interval_seconds / 60) : 1;
    $('#f-interval').value = mins;
    $('#f-interval-label').textContent = mins + ' min';
    $('#f-recurring').checked = alert ? !!alert.recurring : false;
    syncModalFields();
    refreshSymbolOptions();
    $('#modal').classList.remove('hidden');
  }

  function closeModal() { $('#modal').classList.add('hidden'); }

  function submitAlert(e) {
    e.preventDefault();
    var id = $('#alert-id').value;
    var body = {
      asset_type: $('#f-asset-type').value,
      symbol: $('#f-symbol').value.trim(),
      condition_type: $('#f-condition').value,
      target_value: parseFloat($('#f-target').value),
      reference_price: $('#f-ref').value === '' ? null : parseFloat($('#f-ref').value),
      poll_interval_seconds: parseInt($('#f-interval').value, 10) * 60,
      recurring: $('#f-recurring').checked,
    };
    var req = id
      ? api('update-alert', { method: 'PUT', body: Object.assign({ id: id }, body) })
      : api('create-alert', { method: 'POST', body: body });

    req.then(function () {
      closeModal();
      toast('Alert saved', 'ok');
      loadDashboard();
      loadWatchlist();
    }).catch(function (err) {
      var p = $('#form-error');
      p.textContent = err.message;
      p.classList.remove('hidden');
    });
  }

  /* ---------- Watchlist ---------- */
  function loadWatchlist() {
    return api('watchlist').then(function (d) {
      state.watchlist = d.items || [];
      renderWatchlist();
      refreshSymbolOptions();
      refreshCalcSymbolOptions();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderWatchlist() {
    var list = $('#watch-list');
    list.innerHTML = '';

    var starter = (CFG.STARTER_SYMBOLS || []).filter(function (s) {
      return !state.watchlist.some(function (w) { return w.symbol === s.symbol; });
    });

    state.watchlist.forEach(function (w) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML =
        '<span class="sym">' + w.symbol + '</span>' +
        '<span class="badge">' + w.asset_type + '</span>' +
        (w.cached_price != null ? '<span class="price muted">last ' + w.cached_price + '</span>' : '') +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm btn-danger" data-wdel="' + w.id + '">Remove</button>';
      list.appendChild(row);
    });

    if (starter.length) {
      var hint = document.createElement('p');
      hint.className = 'muted small';
      hint.textContent = 'Quick add: ';
      starter.forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'btn btn-sm';
        b.style.margin = '3px';
        b.textContent = s.symbol;
        b.onclick = function () { addWatch(s.symbol, s.asset_type); };
        hint.appendChild(b);
      });
      list.appendChild(hint);
    }

    $$('[data-wdel]').forEach(function (b) {
      b.onclick = function () {
        api('watchlist', { method: 'DELETE', body: { id: b.dataset.wdel } })
          .then(loadWatchlist).catch(function (e) { toast(e.message, 'err'); });
      };
    });
  }

  function addWatch(symbol, type) {
    return api('watchlist', { method: 'POST', body: { symbol: symbol, asset_type: type } })
      .then(loadWatchlist)
      .catch(function (e) { toast(e.message, 'err'); });
  }

  function refreshSymbolOptions() {
    var dl = $('#symbol-options');
    if (!dl) return;
    var seen = {};
    var all = state.watchlist.concat(CFG.STARTER_SYMBOLS || []);
    dl.innerHTML = '';
    all.forEach(function (s) {
      if (seen[s.symbol]) return;
      seen[s.symbol] = 1;
      var o = document.createElement('option');
      o.value = s.symbol;
      dl.appendChild(o);
    });
  }

  /* ---------- Movers & Risk ---------- */
  function fmtPct(v) {
    if (v == null) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function loadMoversRisk() {
    return api('get-movers-risk').then(function (d) {
      renderMovers(d.movers || []);
      renderRisk(d.risk || []);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderMovers(movers) {
    var list = $('#movers-list');
    list.innerHTML = '';
    $('#movers-empty').classList.toggle('hidden', movers.length > 0);

    movers.forEach(function (m) {
      var row = document.createElement('div');
      row.className = 'row clickable';
      var pctCls = (m.percent_change || 0) >= 0 ? 'move-up' : 'move-down';
      row.innerHTML =
        '<span class="sym">' + m.symbol + '</span>' +
        '<span class="badge">' + m.asset_type + '</span>' +
        (m.has_price
          ? '<span class="price">last ' + m.last_price + '</span>' +
            '<span class="' + pctCls + '">' + fmtPct(m.percent_change) + '</span>'
          : '<span class="dim">no price yet</span>') +
        '<span class="spacer"></span>' +
        '<span class="dim">chart ›</span>';
      row.onclick = function () { openChart(m.symbol, m.asset_type); };
      list.appendChild(row);
    });
  }

  function renderRisk(risk) {
    var list = $('#risk-list');
    list.innerHTML = '';
    $('#risk-empty').classList.toggle('hidden', risk.length > 0);

    risk.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'row';
      var desc;
      if (r.last_price == null) {
        desc = 'no price yet — target ' + r.target_value;
      } else if (r.reached) {
        desc = 'condition met — awaiting next engine cycle';
      } else if (r.condition_type === 'pct_change') {
        desc = (r.distance != null ? r.distance.toFixed(2) : '?') +
          ' pts of % move to go (target ' + r.target_value + '%)';
      } else {
        desc = 'needs ' + r.direction + ' ' +
          (r.distance != null ? Math.abs(r.distance).toFixed(4) : '?') +
          ' (' + fmtPct(r.distance_pct) + ') to hit ' + r.target_value;
      }
      var badge = r.reached
        ? '<span class="badge fired">reached</span>'
        : (r.armed ? '<span class="badge ok">armed</span>' : '<span class="badge off">cooldown</span>');
      row.innerHTML =
        '<span class="sym">' + r.symbol + '</span>' +
        '<span class="desc">' + desc + (r.recurring ? ' · recurring' : ' · one-time') + '</span>' +
        badge;
      list.appendChild(row);
    });
  }

  /* ---------- Ticker chart ---------- */
  var chartState = { symbol: null, assetType: 'stock', interval: '1day' };

  function openChart(symbol, assetType) {
    chartState = { symbol: symbol, assetType: assetType || 'stock', interval: '1day' };
    $('#chart-title').textContent = symbol;
    $('#modal') && $('#modal').classList.add('hidden');
    $('#chart-modal').classList.remove('hidden');
    setChartInterval('1day');
  }

  function closeChart() { $('#chart-modal').classList.add('hidden'); }

  function setChartInterval(iv) {
    chartState.interval = iv;
    $$('#chart-intervals .btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.iv === iv);
    });
    $('#chart-status').textContent = 'Loading…';
    clearCanvas();
    var qs = 'symbol=' + encodeURIComponent(chartState.symbol) +
      '&asset_type=' + encodeURIComponent(chartState.assetType) +
      '&interval=' + encodeURIComponent(iv);
    api('get-symbol-chart?' + qs).then(function (d) {
      drawChart(d.points || []);
      var pts = d.points || [];
      if (pts.length >= 2) {
        var chg = ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
        $('#chart-status').textContent = pts.length + ' points · ' +
          d.interval + ' · ' + fmtPct(chg) + ' over range';
      } else {
        $('#chart-status').textContent = pts.length + ' point(s)';
      }
    }).catch(function (e) {
      $('#chart-status').textContent = e.message;
    });
  }

  function clearCanvas() {
    var c = $('#chart-canvas');
    var ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  }

  function drawChart(points) {
    var c = $('#chart-canvas');
    var ctx = c.getContext('2d');
    var W = c.width, H = c.height, pad = 34;
    ctx.clearRect(0, 0, W, H);
    if (points.length < 2) return;

    var vals = points.map(function (p) { return p.close; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var x = function (i) { return pad + (i / (points.length - 1)) * (W - pad - 8); };
    var y = function (v) { return H - pad - ((v - min) / (max - min)) * (H - pad - 12); };

    var css = getComputedStyle(document.documentElement);
    var line = css.getPropertyValue('--primary').trim() || '#4c8dff';
    var grid = css.getPropertyValue('--border').trim() || '#313c52';
    var muted = css.getPropertyValue('--muted').trim() || '#8b97ad';

    // axes / gridlines
    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted;
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    for (var g = 0; g <= 3; g++) {
      var gy = pad / 2 + (g / 3) * (H - pad - 6);
      ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - 8, gy); ctx.stroke();
      var gv = max - (g / 3) * (max - min);
      ctx.fillText(gv.toFixed(gv < 10 ? 4 : 2), 2, gy + 3);
    }

    // price line
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach(function (p, i) {
      var px = x(i), py = y(p.close);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // endpoints labels
    ctx.fillStyle = muted;
    ctx.fillText(points[0].datetime.slice(0, 10), pad, H - 8);
    var lastLbl = points[points.length - 1].datetime.slice(0, 10);
    ctx.fillText(lastLbl, W - 8 - ctx.measureText(lastLbl).width, H - 8);
  }

  /* ---------- Sector breakdown ---------- */
  function loadSectors() {
    return api('get-sector-breakdown').then(function (d) {
      renderSectors(d);
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderSectors(d) {
    var list = $('#sectors-list');
    var sectors = d.sectors || [];
    var unknown = d.unknown || [];
    list.innerHTML = '';
    $('#sectors-empty').classList.toggle('hidden', d.total > 0);
    $('#sectors-summary').textContent = d.total
      ? (d.classified + ' of ' + d.total + ' stocks classified')
      : '';

    var maxCount = sectors.reduce(function (m, s) { return Math.max(m, s.count); }, 1);

    sectors.forEach(function (s) {
      var g = document.createElement('div');
      g.className = 'row sector-group';
      var chips = s.symbols.map(function (sym) {
        var cls = (sym.percent_change || 0) >= 0 ? 'move-up' : 'move-down';
        return '<span class="chip">' + sym.symbol +
          (sym.percent_change != null ? ' <span class="' + cls + '">' + fmtPct(sym.percent_change) + '</span>' : '') +
          '</span>';
      }).join('');
      g.innerHTML =
        '<h3>' + s.sector + ' <span class="muted small">· ' + s.count + '</span></h3>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' +
          Math.round((s.count / maxCount) * 100) + '%"></div></div>' +
        '<div class="chips">' + chips + '</div>';
      list.appendChild(g);
    });

    if (unknown.length) {
      var u = document.createElement('div');
      u.className = 'row sector-group';
      u.innerHTML =
        '<h3>Unclassified <span class="muted small">· ' + unknown.length + '</span></h3>' +
        '<div class="chips">' + unknown.map(function (sym) {
          return '<span class="chip">' + sym.symbol + '</span>';
        }).join('') + '</div>';
      list.appendChild(u);
    }
  }

  /* ---------- Position calculator ---------- */
  function calcPrefill() {
    var sym = $('#calc-symbol').value.trim().toUpperCase();
    if (!sym) return;
    var w = state.watchlist.filter(function (x) { return x.symbol === sym; })[0];
    if (w && w.cached_price != null && $('#calc-buy').value === '') {
      $('#calc-buy').value = w.cached_price;
    }
  }

  function calcSubmit(e) {
    e.preventDefault();
    var err = $('#calc-error');
    var res = $('#calc-result');
    err.classList.add('hidden');
    res.classList.add('hidden');

    var shares = parseFloat($('#calc-shares').value);
    var avg = parseFloat($('#calc-avg').value);
    var target = parseFloat($('#calc-target').value);
    var buy = parseFloat($('#calc-buy').value);

    if ([shares, avg, target, buy].some(function (n) { return !isFinite(n); })) {
      err.textContent = 'Fill in shares owned, current average, target average and buy price.';
      err.classList.remove('hidden');
      return;
    }
    if (shares < 0 || avg <= 0 || target <= 0 || buy <= 0) {
      err.textContent = 'Values must be positive (shares owned may be 0).';
      err.classList.remove('hidden');
      return;
    }

    var solved = window.PositionCalc.solveSharesToTarget(shares, avg, target, buy);
    var n = solved.shares;

    var html;
    if (!solved.reachable || n == null) {
      var why = buy >= target && target < avg
        ? 'Buy price is at/above the target, so buying more can only raise the average.'
        : buy <= target && target > avg
        ? 'Buy price is at/below the target, so buying more can only lower the average.'
        : (solved.reason || 'Target is not reachable by buying at this price.');
      html = '<div class="big">Not reachable</div><ul><li>' + why + '</li></ul>';
    } else {
      var newShares = shares + n;
      var cost = n * buy;
      html =
        '<div class="big">Buy ' + n.toFixed(2) + ' shares @ ' + buy + '</div>' +
        '<ul>' +
        '<li>Additional cost: ' + cost.toFixed(2) + '</li>' +
        '<li>New position: ' + newShares.toFixed(2) + ' shares @ avg ' + target + '</li>' +
        '<li>Current book value: ' + (shares * avg).toFixed(2) +
          ' → ' + (newShares * target).toFixed(2) + '</li>' +
        '</ul>';
    }
    res.innerHTML = html;
    res.classList.remove('hidden');
  }

  function calcReset() {
    $('#calc-form').reset();
    $('#calc-error').classList.add('hidden');
    $('#calc-result').classList.add('hidden');
  }

  function refreshCalcSymbolOptions() {
    var dl = $('#calc-symbol-options');
    if (!dl) return;
    dl.innerHTML = '';
    var seen = {};
    state.watchlist.concat(CFG.STARTER_SYMBOLS || []).forEach(function (s) {
      if (s.asset_type !== 'stock' || seen[s.symbol]) return;
      seen[s.symbol] = 1;
      var o = document.createElement('option');
      o.value = s.symbol;
      dl.appendChild(o);
    });
  }

  /* ---------- Notifications: Telegram ---------- */
  function loadTelegram() {
    return api('get-telegram-link-code').then(function (d) {
      var s = $('#tg-status');
      if (d.linked) {
        s.textContent = 'Linked ✓';
        s.className = 'status linked';
      } else {
        s.textContent = 'Not linked yet';
        s.className = 'status unlinked';
      }
      $('#tg-command').textContent = d.start_command || ('/start ' + (d.code || ''));
      if (d.bot_username) $('#tg-botname').textContent = '@' + d.bot_username;
      if (!d.configured) s.textContent = 'Telegram bot not configured on the server';
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------- Notifications: OneSignal ---------- */
  var oneSignalReady = false;
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(function (OneSignal) {
    if (!CFG.ONESIGNAL_APP_ID) return;
    OneSignal.init({ appId: CFG.ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true })
      .then(function () {
        oneSignalReady = true;
        OneSignal.User.PushSubscription.addEventListener('change', syncOneSignal);
        syncOneSignal();
      });
  });

  function withOneSignal(fn) {
    window.OneSignalDeferred.push(fn);
  }

  function syncOneSignal() {
    withOneSignal(function (OneSignal) {
      var sub = OneSignal.User.PushSubscription;
      var id = sub && sub.id;
      var optedIn = sub && sub.optedIn;
      var s = $('#os-status');
      if (id && optedIn) {
        s.textContent = 'Enabled ✓';
        s.className = 'status linked';
        $('#os-enable').classList.add('hidden');
        $('#os-disable').classList.remove('hidden');
        if (state.me && !state.me.onesignal_linked) {
          api('link-onesignal', { method: 'POST', body: { player_id: id } })
            .then(function () { state.me.onesignal_linked = true; });
        }
      } else {
        s.textContent = 'Not enabled';
        s.className = 'status unlinked';
        $('#os-enable').classList.remove('hidden');
        $('#os-disable').classList.add('hidden');
      }
    });
  }

  function enableOneSignal() {
    if (!CFG.ONESIGNAL_APP_ID) { toast('OneSignal app ID not configured', 'err'); return; }
    withOneSignal(function (OneSignal) {
      OneSignal.User.PushSubscription.optIn()
        .then(function () { return OneSignal.Notifications.requestPermission(); })
        .then(function () {
          setTimeout(function () {
            var id = OneSignal.User.PushSubscription.id;
            if (id) {
              api('link-onesignal', { method: 'POST', body: { player_id: id } })
                .then(function () { toast('Browser alerts enabled', 'ok'); syncOneSignal(); });
            } else {
              toast('Permission not granted', 'err');
            }
          }, 800);
        })
        .catch(function (e) { toast(String(e), 'err'); });
    });
  }

  function disableOneSignal() {
    withOneSignal(function (OneSignal) {
      OneSignal.User.PushSubscription.optOut();
      api('link-onesignal', { method: 'POST', body: { player_id: null } })
        .then(function () {
          if (state.me) state.me.onesignal_linked = false;
          toast('Browser alerts disabled', 'ok');
          syncOneSignal();
        });
    });
  }

  /* ---------- Admin ---------- */
  function loadAdmin() {
    return api('admin-list-pending').then(function (d) {
      $('#pending-count').textContent = (d.pending || []).length;
      $('#pending-empty').classList.toggle('hidden', (d.pending || []).length > 0);

      var pl = $('#pending-list');
      pl.innerHTML = '';
      (d.pending || []).forEach(function (u) {
        var row = document.createElement('div');
        row.className = 'row';
        row.innerHTML =
          '<span class="desc">' + u.email + ' · signed up ' +
          new Date(u.created_at).toLocaleDateString() + '</span><span class="spacer"></span>' +
          '<button class="btn btn-sm btn-primary" data-approve="' + u.id + '">Approve</button>' +
          '<button class="btn btn-sm btn-danger" data-reject="' + u.id + '">Reject</button>';
        pl.appendChild(row);
      });

      var ul = $('#users-list');
      ul.innerHTML = '';
      (d.users || []).forEach(function (u) {
        var row = document.createElement('div');
        row.className = 'row';
        var tags = [
          u.is_admin ? '<span class="badge ok">admin</span>' : '',
          u.approved ? '<span class="badge ok">approved</span>' : '<span class="badge off">pending</span>',
          u.telegram_linked ? '<span class="badge">telegram</span>' : '',
          u.onesignal_linked ? '<span class="badge">push</span>' : '',
        ].join(' ');
        row.innerHTML =
          '<span class="desc">' + u.email + ' · ' + u.alert_count + ' alerts</span>' +
          '<span class="spacer"></span>' + tags +
          (u.approved ? '' : '<button class="btn btn-sm btn-primary" data-approve="' + u.id + '">Approve</button>');
        ul.appendChild(row);
      });

      $$('[data-approve]').forEach(function (b) {
        b.onclick = function () {
          api('admin-approve-user', { method: 'POST', body: { user_id: b.dataset.approve, approve: true } })
            .then(function () { toast('Approved', 'ok'); loadAdmin(); })
            .catch(function (e) { toast(e.message, 'err'); });
        };
      });
      $$('[data-reject]').forEach(function (b) {
        b.onclick = function () {
          if (!confirm('Reject / revoke this user?')) return;
          api('admin-approve-user', { method: 'POST', body: { user_id: b.dataset.reject, approve: false } })
            .then(function () { toast('Rejected', 'ok'); loadAdmin(); })
            .catch(function (e) { toast(e.message, 'err'); });
        };
      });
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------- In-page trigger watch + sound ---------- */
  // While the tab is open, poll the caller's alerts and chime + banner when an
  // alert's last_triggered_at advances. This is a client-side convenience on top
  // of the server-side Telegram / push channels — it needs the tab to be open.
  var TRIGGER_POLL_MS = 45000;
  var triggerSeen = null;   // map alertId -> last_triggered_at; null until baseline set
  var triggerTimer = null;
  var audioCtx = null;

  function soundOn() {
    try { return localStorage.getItem('alertSound') !== 'off'; } catch (e) { return true; }
  }
  function setSoundOn(on) {
    try { localStorage.setItem('alertSound', on ? 'on' : 'off'); } catch (e) {}
  }

  function ensureAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }

  // Short two-tone chime synthesised with WebAudio — no asset file needed.
  function chime() {
    var ctx = ensureAudio();
    if (!ctx) return;
    var start = ctx.currentTime;
    [[880, 0], [1174.7, 0.16]].forEach(function (p) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = p[0];
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t = start + p[1];
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.start(t);
      osc.stop(t + 0.42);
    });
  }

  function startTriggerWatch() {
    stopTriggerWatch();
    triggerSeen = null;
    pollTriggers();
    triggerTimer = setInterval(pollTriggers, TRIGGER_POLL_MS);
  }

  function stopTriggerWatch() {
    if (triggerTimer) clearInterval(triggerTimer);
    triggerTimer = null;
    triggerSeen = null;
  }

  function pollTriggers() {
    if (!identity.currentUser() || document.hidden) return;
    api('list-alerts').then(function (d) {
      var alerts = d.alerts || [];
      state.alerts = alerts;
      // keep the dashboard's "fired" badges live if it's the visible view
      if (!$('#view-dashboard').classList.contains('hidden')) renderAlerts();

      var fresh = {};
      alerts.forEach(function (a) {
        if (a.last_triggered_at) fresh[a.id] = a.last_triggered_at;
      });

      if (triggerSeen === null) { triggerSeen = fresh; return; } // baseline only

      var fired = alerts.filter(function (a) {
        if (!a.last_triggered_at) return false;
        var prev = triggerSeen[a.id];
        return !prev || new Date(a.last_triggered_at) > new Date(prev);
      });
      triggerSeen = fresh;

      if (fired.length) {
        var names = fired.map(function (a) { return a.symbol; }).join(', ');
        toast('🔔 Alert fired: ' + names, 'ok');
        if (soundOn()) chime();
      }
    }).catch(function () { /* transient — try again next tick */ });
  }

  /* ---------- Wiring ---------- */
  function init() {
    var tick = CFG.POLL_TICK_LABEL || 'every minute';
    $('#landing-tick').textContent = tick;
    $('#dash-tick').textContent = tick;

    identity.on('init', function () { bootstrap(); });
    identity.on('login', function () { identity.close(); bootstrap(); });
    identity.on('logout', function () { state.me = null; bootstrap(); });
    identity.init();

    $('#btn-login').onclick = function () { identity.open(); };
    $('#btn-login-2').onclick = function () { identity.open(); };
    $('#btn-logout').onclick = function () { identity.logout(); };
    $('#btn-refresh-status').onclick = function () { bootstrap(); };

    $$('.nav-btn').forEach(function (b) {
      b.onclick = function () {
        var v = b.dataset.view;
        show(v);
        if (v === 'dashboard') loadDashboard();
        if (v === 'watchlist') loadWatchlist();
        if (v === 'movers-risk') loadMoversRisk();
        if (v === 'sectors') loadSectors();
        if (v === 'calculator') refreshCalcSymbolOptions();
        if (v === 'notifications') { loadTelegram(); syncOneSignal(); }
        if (v === 'admin') loadAdmin();
      };
    });

    $('#btn-new-alert').onclick = function () { openModal(null); };
    $('#btn-cancel').onclick = closeModal;
    $('#modal').onclick = function (e) { if (e.target === $('#modal')) closeModal(); };
    $('#alert-form').onsubmit = submitAlert;
    $('#f-condition').onchange = syncModalFields;
    $('#f-interval').oninput = function () {
      $('#f-interval-label').textContent = $('#f-interval').value + ' min';
    };

    $('#watch-form').onsubmit = function (e) {
      e.preventDefault();
      var sym = $('#watch-symbol').value.trim();
      if (!sym) return;
      addWatch(sym, $('#watch-type').value).then(function () { $('#watch-symbol').value = ''; });
    };

    $('#tg-copy').onclick = function () {
      navigator.clipboard.writeText($('#tg-command').textContent).then(function () {
        toast('Copied', 'ok');
      });
    };
    $('#tg-regen').onclick = function () {
      api('get-telegram-link-code', { method: 'POST' }).then(loadTelegram);
    };
    $('#os-enable').onclick = enableOneSignal;
    $('#os-disable').onclick = disableOneSignal;

    // Chart modal
    $('#chart-close').onclick = closeChart;
    $('#chart-modal').onclick = function (e) { if (e.target === $('#chart-modal')) closeChart(); };
    $$('#chart-intervals .btn').forEach(function (b) {
      b.onclick = function () { setChartInterval(b.dataset.iv); };
    });

    // Position calculator
    $('#calc-form').onsubmit = calcSubmit;
    $('#calc-reset').onclick = calcReset;
    $('#calc-symbol').onchange = calcPrefill;

    // In-page sound alert
    var sndToggle = $('#snd-toggle');
    if (sndToggle) {
      sndToggle.checked = soundOn();
      sndToggle.onchange = function () {
        setSoundOn(sndToggle.checked);
        if (sndToggle.checked) chime(); // also primes the audio context
      };
      $('#snd-test').onclick = function () { ensureAudio(); chime(); };
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && triggerTimer) pollTriggers();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
