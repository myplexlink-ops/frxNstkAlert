/* The Alert Desk — vanilla frontend */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var state = {
    me: null, alerts: [], watchlist: [],
    movers: [], risk: [],
    tgLinked: false, osEnabled: false
  };

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
    $$('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === view);
    });
  }

  function loadView(view) {
    if (view === 'desk') { loadAlerts(); loadWatchlist(); loadMoversRisk(); loadTelegram(); syncOneSignal(); }
    if (view === 'alerts') loadAlerts();
    if (view === 'watchlist') loadWatchlist();
    if (view === 'market') { loadMoversRisk(); loadSectors(); }
    if (view === 'calculator') refreshCalcSymbolOptions();
    if (view === 'delivery') { loadTelegram(); syncOneSignal(); }
    if (view === 'admin') loadAdmin();
  }

  function goto(view) {
    show(view);
    loadView(view);
  }

  function fmtCondition(a) {
    if (a.condition_type === 'cross_above') return 'crosses above ' + a.target_value;
    if (a.condition_type === 'cross_below') return 'crosses below ' + a.target_value;
    return '% change reaches ' + a.target_value + '%' +
      (a.reference_price ? ' (ref ' + a.reference_price + ')' : '');
  }

  function fmtPct(v) {
    if (v == null) return '—';
    var n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function timeAgo(iso) {
    var d = new Date(iso);
    var diffMs = Date.now() - d.getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.round(hrs / 24);
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
  }

  /* ---------- Bootstrap / routing ---------- */
  function bootstrap() {
    var u = identity.currentUser();
    if (!u) {
      stopTriggerWatch();
      $('#nav').classList.add('hidden');
      $('#btn-new-alert').classList.add('hidden');
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
        $('#btn-new-alert').classList.add('hidden');
        $('#pending-email').textContent = me.email;
        show('pending');
        return;
      }
      $('#nav').classList.remove('hidden');
      $('#btn-new-alert').classList.remove('hidden');
      $('#nav-admin').classList.toggle('hidden', !me.is_admin);
      goto('desk');
      startTriggerWatch();
    }).catch(function (e) {
      toast(e.message, 'err');
    });
  }

  /* ---------- Alerts ---------- */
  function loadAlerts() {
    return api('list-alerts').then(function (d) {
      state.alerts = d.alerts || [];
      renderAlerts();
      renderDesk();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderAlerts() {
    var list = $('#alerts-list');
    list.innerHTML = '';
    $('#alerts-empty').classList.toggle('hidden', state.alerts.length > 0);

    state.alerts.forEach(function (a) {
      var tr = document.createElement('tr');

      var stateTag = !a.active
        ? '<span class="tag tag-neutral">Fired / inactive</span>'
        : (a.armed ? '<span class="tag tag-accent">Armed</span>' : '<span class="tag tag-neutral">Cooldown</span>');

      var lastText = a.cached_price != null
        ? (a.cached_price + (a.cached_percent_change != null ? ' (' + fmtPct(a.cached_percent_change) + ')' : ''))
        : '—';

      tr.innerHTML =
        '<td><div style="font-size:15px">' + a.symbol + '</div>' +
          '<div class="small" style="letter-spacing:.06em;text-transform:uppercase;color:var(--color-neutral-600)">' + a.asset_type + '</div></td>' +
        '<td>' + fmtCondition(a) + '</td>' +
        '<td class="num">' + a.target_value + '</td>' +
        '<td class="num">' + lastText + '</td>' +
        '<td>' + Math.round(a.poll_interval_seconds / 60) + ' min</td>' +
        '<td>' + (a.recurring ? 'Recurring' : 'One-time') + '</td>' +
        '<td>' + stateTag + '</td>' +
        '<td class="num" style="white-space:nowrap">' +
          '<button class="btn btn-ghost btn-sm" data-edit="' + a.id + '">Edit</button>' +
          '<button class="btn btn-danger-ghost btn-sm" data-del="' + a.id + '">Delete</button></td>';
      list.appendChild(tr);
    });

    $$('[data-edit]').forEach(function (b) {
      b.onclick = function () { openModal(findAlert(b.dataset.edit)); };
    });
    $$('[data-del]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this alert?')) return;
        api('delete-alert', { method: 'DELETE', body: { id: b.dataset.del } })
          .then(function () { toast('Alert deleted', 'ok'); loadAlerts(); })
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
    $('#l-target label').textContent = isPct ? 'Target % change' : 'Target value';
  }

  function openModal(alert) {
    $('#form-error').classList.add('hidden');
    $('#modal-title').textContent = alert ? 'Edit alert' : 'New alert';
    $('#alert-id').value = alert ? alert.id : '';
    var atype = alert ? alert.asset_type : 'forex';
    $$('input[name=atype]').forEach(function (r) { r.checked = r.value === atype; });
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
    var atype = ($('input[name=atype]:checked') || {}).value || 'forex';
    var body = {
      asset_type: atype,
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
      loadAlerts();
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
      renderDesk();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderWatchlist() {
    var list = $('#watch-list');
    list.innerHTML = '';

    var starter = (CFG.STARTER_SYMBOLS || []).filter(function (s) {
      return !state.watchlist.some(function (w) { return w.symbol === s.symbol; });
    });

    state.watchlist.forEach(function (w) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button class="link-btn" data-chart="' + w.symbol + '" data-type="' + w.asset_type + '">' + w.symbol + '</button></td>' +
        '<td class="small" style="letter-spacing:.06em;text-transform:uppercase;color:var(--color-neutral-600)">' + w.asset_type + '</td>' +
        '<td class="num">' + (w.cached_price != null ? w.cached_price : '—') + '</td>' +
        '<td class="num" style="white-space:nowrap"><button class="btn btn-danger-ghost btn-sm" data-wdel="' + w.id + '">Remove</button></td>';
      list.appendChild(tr);
    });

    var qa = $('#watch-quickadd');
    qa.innerHTML = '';
    if (starter.length) {
      var hint = document.createElement('p');
      hint.className = 'muted small';
      hint.style.marginTop = '14px';
      hint.textContent = 'Quick add: ';
      starter.forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'btn btn-secondary btn-sm';
        b.style.margin = '3px';
        b.textContent = s.symbol;
        b.onclick = function () { addWatch(s.symbol, s.asset_type); };
        hint.appendChild(b);
      });
      qa.appendChild(hint);
    }

    $$('[data-wdel]').forEach(function (b) {
      b.onclick = function () {
        api('watchlist', { method: 'DELETE', body: { id: b.dataset.wdel } })
          .then(loadWatchlist).catch(function (e) { toast(e.message, 'err'); });
      };
    });
    $$('[data-chart]').forEach(function (b) {
      b.onclick = function () { openChart(b.dataset.chart, b.dataset.type); };
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

  /* ---------- Market: movers & risk ---------- */
  function loadMoversRisk() {
    return api('get-movers-risk').then(function (d) {
      state.movers = d.movers || [];
      state.risk = d.risk || [];
      renderMovers();
      renderRisk();
      renderDesk();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  function renderMovers() {
    var list = $('#movers-list');
    list.innerHTML = '';
    $('#movers-empty').classList.toggle('hidden', state.movers.length > 0);

    state.movers.forEach(function (m) {
      var tr = document.createElement('tr');
      var pctCls = (m.percent_change || 0) >= 0 ? 'up' : 'down';
      tr.innerHTML =
        '<td><button class="link-btn" data-chart="' + m.symbol + '" data-type="' + m.asset_type + '">' + m.symbol + '</button></td>' +
        '<td class="num">' + (m.has_price ? m.last_price : '—') + '</td>' +
        '<td class="num ' + (m.has_price ? pctCls : '') + '">' + (m.has_price ? fmtPct(m.percent_change) : '—') + '</td>';
      list.appendChild(tr);
    });
    $$('#movers-list [data-chart]').forEach(function (b) {
      b.onclick = function () { openChart(b.dataset.chart, b.dataset.type); };
    });
  }

  function renderRisk() {
    var list = $('#risk-list');
    list.innerHTML = '';
    $('#risk-empty').classList.toggle('hidden', state.risk.length > 0);

    state.risk.forEach(function (r) {
      var li = document.createElement('li');
      li.style.cssText = 'padding:12px 0;border-bottom:1px solid color-mix(in srgb, var(--color-text) 8%, transparent)';
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
      var tag = r.reached
        ? '<span class="tag tag-accent-2">Reached</span>'
        : (r.armed ? '<span class="tag tag-accent">Armed</span>' : '<span class="tag tag-neutral">Cooldown</span>');
      var barW = riskBarPct(r);
      li.innerHTML =
        '<div style="display:flex;align-items:baseline;gap:10px">' +
          '<strong style="font-size:15px">' + r.symbol + '</strong>' +
          '<span class="muted small">' + desc + (r.recurring ? ' · recurring' : ' · one-time') + '</span>' +
        '</div>' +
        '<div class="bar-row" style="margin-top:7px">' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + barW + '%"></div></div>' + tag +
        '</div>';
      list.appendChild(li);
    });
  }

  function riskBarPct(r) {
    if (r.reached) return 100;
    if (r.condition_type === 'pct_change') {
      if (r.distance == null || !r.target_value) return 0;
      return Math.max(0, Math.min(100, 100 - (Math.abs(r.distance) / Math.abs(r.target_value)) * 100));
    }
    if (r.distance_pct == null) return 0;
    return Math.max(0, Math.min(100, 100 - (Math.abs(r.distance_pct) / 5) * 100));
  }

  /* ---------- Front page (desk) ---------- */
  function renderDesk() {
    if (!$('#view-desk')) return;

    // Engine
    $('#desk-active-count').textContent = state.alerts.filter(function (a) { return a.armed; }).length;
    $('#desk-symbol-count').textContent = state.watchlist.length;

    // Closest to firing — armed risk rows with a cached price, nearest first
    var near = state.risk.filter(function (r) { return r.armed && r.last_price != null && !r.reached; });
    near.sort(function (a, b) { return riskBarPct(b) - riskBarPct(a); });
    near = near.slice(0, 4);

    var body = $('#desk-near-body');
    body.innerHTML = '';
    near.forEach(function (r) {
      var barW = riskBarPct(r);
      var distText = r.condition_type === 'pct_change'
        ? (r.distance != null ? r.distance.toFixed(2) + ' pts' : '—')
        : fmtPct(r.distance_pct);
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><button class="link-btn" data-chart="' + r.symbol + '" data-type="' + r.asset_type + '">' + r.symbol + '</button></td>' +
        '<td>' + fmtCondition(r) + '</td>' +
        '<td class="num">' + r.last_price + '</td>' +
        '<td class="num">' + r.target_value + '</td>' +
        '<td><div class="bar-row"><div class="bar-track"><div class="bar-fill" style="width:' + barW + '%"></div></div>' +
          '<span class="bar-text">' + distText + '</span></div></td>';
      body.appendChild(tr);
    });
    $('#desk-near-empty').classList.toggle('hidden', near.length > 0);
    $$('#desk-near-body [data-chart]').forEach(function (b) {
      b.onclick = function () { openChart(b.dataset.chart, b.dataset.type); };
    });

    if (near.length) {
      var lead = near[0];
      $('#desk-headline').textContent = lead.symbol + ' ' + fmtCondition(lead);
      $('#desk-standfirst').textContent = 'Last ' + lead.last_price + ' — ' +
        (lead.condition_type === 'pct_change'
          ? (lead.distance != null ? lead.distance.toFixed(2) + ' points of move to go.' : '')
          : fmtPct(lead.distance_pct) + ' from the target.');
    } else {
      $('#desk-headline').textContent = 'Nothing armed yet';
      $('#desk-standfirst').textContent = 'Add a watchlist symbol and create an alert to see it here.';
    }

    // Movers
    var movers = state.movers.filter(function (m) { return m.has_price; })
      .slice()
      .sort(function (a, b) { return Math.abs(b.percent_change || 0) - Math.abs(a.percent_change || 0); })
      .slice(0, 4);
    var mv = $('#desk-movers');
    mv.innerHTML = '';
    movers.forEach(function (m) {
      var cls = (m.percent_change || 0) >= 0 ? 'up' : 'down';
      var btn = document.createElement('button');
      btn.className = 'mover-card';
      btn.innerHTML =
        '<div class="sym">' + m.symbol + '</div>' +
        '<div class="pct ' + cls + '">' + fmtPct(m.percent_change) + '</div>' +
        '<div class="last">' + m.last_price + '</div>';
      btn.onclick = function () { openChart(m.symbol, m.asset_type); };
      mv.appendChild(btn);
    });
    $('#desk-movers-empty').classList.toggle('hidden', movers.length > 0);

    // Fired recently
    var fired = state.alerts.filter(function (a) { return a.last_triggered_at; })
      .slice()
      .sort(function (a, b) { return new Date(b.last_triggered_at) - new Date(a.last_triggered_at); })
      .slice(0, 3);
    var fl = $('#desk-fired');
    fl.innerHTML = '';
    fired.forEach(function (a) {
      var li = document.createElement('li');
      li.innerHTML =
        '<div class="when">' + timeAgo(a.last_triggered_at) + '</div>' +
        '<div class="what"><strong>' + a.symbol + '</strong> ' + fmtCondition(a) + '</div>';
      fl.appendChild(li);
    });
    $('#desk-fired-empty').classList.toggle('hidden', fired.length > 0);

    // Delivery mini
    $('#desk-tg-status').textContent = state.tgLinked ? 'Linked' : 'Not linked';
    $('#desk-os-status').textContent = state.osEnabled ? 'Subscribed' : 'Not subscribed';
    $('#desk-sound-status').textContent = soundOn() ? 'On' : 'Off';
  }

  /* ---------- Ticker chart ---------- */
  var chartState = { symbol: null, assetType: 'stock', interval: '1day' };

  function openChart(symbol, assetType) {
    chartState = { symbol: symbol, assetType: assetType || 'stock', interval: '1day' };
    $('#chart-title').textContent = symbol;
    $('#modal') && $('#modal').classList.add('hidden');
    $$('#chart-intervals input').forEach(function (r) { r.checked = r.dataset.iv === '1day'; });
    $('#chart-modal').classList.remove('hidden');
    setChartInterval('1day');
  }

  function closeChart() { $('#chart-modal').classList.add('hidden'); }

  function setChartInterval(iv) {
    chartState.interval = iv;
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
    var line = css.getPropertyValue('--color-accent').trim() || '#0088b0';
    var grid = css.getPropertyValue('--color-neutral-300').trim() || '#d7d3d3';
    var muted = css.getPropertyValue('--color-neutral-600').trim() || '#7d7979';

    ctx.strokeStyle = grid; ctx.lineWidth = 1; ctx.fillStyle = muted;
    ctx.font = '11px "Source Serif 4", Georgia, serif';
    for (var g = 0; g <= 3; g++) {
      var gy = pad / 2 + (g / 3) * (H - pad - 6);
      ctx.beginPath(); ctx.moveTo(pad, gy); ctx.lineTo(W - 8, gy); ctx.stroke();
      var gv = max - (g / 3) * (max - min);
      ctx.fillText(gv.toFixed(gv < 10 ? 4 : 2), 2, gy + 3);
    }

    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.beginPath();
    points.forEach(function (p, i) {
      var px = x(i), py = y(p.close);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

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
      : 'Equity watchlist only — forex is excluded.';

    var maxCount = sectors.reduce(function (m, s) { return Math.max(m, s.count); }, 1);

    sectors.forEach(function (s) {
      var g = document.createElement('div');
      g.className = 'sector-block';
      var chips = s.symbols.map(function (sym) {
        var cls = (sym.percent_change || 0) >= 0 ? 'up' : 'down';
        return '<button class="tag tag-neutral" data-chart="' + sym.symbol + '"><span>' + sym.symbol + '</span>' +
          (sym.percent_change != null ? ' <span class="' + cls + '">' + fmtPct(sym.percent_change) + '</span>' : '') +
          '</button>';
      }).join('');
      g.innerHTML =
        '<div class="head"><h4>' + s.sector + '</h4><span class="muted small">' + s.count + '</span></div>' +
        '<div class="bar-fill wide" style="width:' + Math.round((s.count / maxCount) * 100) + '%"></div>' +
        '<div class="chips">' + chips + '</div>';
      list.appendChild(g);
    });

    if (unknown.length) {
      var u = document.createElement('div');
      u.className = 'sector-block';
      u.innerHTML =
        '<div class="head"><h4>Unclassified</h4><span class="muted small">' + unknown.length + '</span></div>' +
        '<div class="chips">' + unknown.map(function (sym) {
          return '<button class="tag tag-neutral" data-chart="' + sym.symbol + '">' + sym.symbol + '</button>';
        }).join('') + '</div>';
      list.appendChild(u);
    }

    $$('#sectors-list [data-chart]').forEach(function (b) {
      b.onclick = function () { openChart(b.dataset.chart, 'stock'); };
    });
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
    $('#calc-idle').classList.add('hidden');

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
      html = '<h3 style="margin:0 0 6px">Not reachable</h3><p style="max-width:44ch;margin:0">' + why + '</p>';
    } else {
      var newShares = shares + n;
      var cost = n * buy;
      html =
        '<p class="kicker">Buy</p>' +
        '<div class="calc-figure">' + n.toFixed(2) + '</div>' +
        '<p style="max-width:40ch;margin:10px 0 22px">shares @ ' + buy + '</p>' +
        '<table class="table" style="max-width:460px"><tbody>' +
        '<tr><td class="muted">Additional cost</td><td class="num">' + cost.toFixed(2) + '</td></tr>' +
        '<tr><td class="muted">New position</td><td class="num">' + newShares.toFixed(2) + ' @ avg ' + target + '</td></tr>' +
        '<tr><td class="muted">Book value</td><td class="num">' + (shares * avg).toFixed(2) + ' → ' + (newShares * target).toFixed(2) + '</td></tr>' +
        '</tbody></table>';
    }
    res.innerHTML = html;
    res.classList.remove('hidden');
  }

  function calcReset() {
    $('#calc-form').reset();
    $('#calc-error').classList.add('hidden');
    $('#calc-result').classList.add('hidden');
    $('#calc-idle').classList.remove('hidden');
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

  /* ---------- Delivery: Telegram ---------- */
  function loadTelegram() {
    return api('get-telegram-link-code').then(function (d) {
      state.tgLinked = !!d.linked;
      var s = $('#tg-status');
      if (d.linked) {
        s.textContent = 'Linked';
        s.className = 'tag tag-accent';
      } else {
        s.textContent = 'Not linked';
        s.className = 'tag tag-neutral';
      }
      $('#tg-command').textContent = d.start_command || ('/start ' + (d.code || ''));
      if (d.bot_username) $('#tg-botname').textContent = '@' + d.bot_username;
      if (!d.configured) s.textContent = 'Not configured';
      renderDesk();
    }).catch(function (e) { toast(e.message, 'err'); });
  }

  /* ---------- Delivery: OneSignal ---------- */
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(function (OneSignal) {
    if (!CFG.ONESIGNAL_APP_ID) return;
    OneSignal.init({ appId: CFG.ONESIGNAL_APP_ID, allowLocalhostAsSecureOrigin: true })
      .then(function () {
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
      state.osEnabled = !!(id && optedIn);
      if (id && optedIn) {
        s.textContent = 'Subscribed';
        s.className = 'tag tag-accent';
        $('#os-enable').classList.add('hidden');
        $('#os-disable').classList.remove('hidden');
        if (state.me && !state.me.onesignal_linked) {
          api('link-onesignal', { method: 'POST', body: { player_id: id } })
            .then(function () { state.me.onesignal_linked = true; });
        }
      } else {
        s.textContent = 'Not subscribed';
        s.className = 'tag tag-neutral';
        $('#os-enable').classList.remove('hidden');
        $('#os-disable').classList.add('hidden');
      }
      renderDesk();
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
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + u.email + '</td>' +
          '<td class="muted">' + new Date(u.created_at).toLocaleDateString() + '</td>' +
          '<td class="num" style="white-space:nowrap">' +
            '<button class="btn btn-ghost btn-sm" data-approve="' + u.id + '">Approve</button>' +
            '<button class="btn btn-danger-ghost btn-sm" data-reject="' + u.id + '">Reject</button></td>';
        pl.appendChild(tr);
      });

      var ul = $('#users-list');
      ul.innerHTML = '';
      (d.users || []).forEach(function (u) {
        var tr = document.createElement('tr');
        var tags = [
          u.is_admin ? '<span class="tag tag-accent">admin</span>' : '',
          u.approved ? '<span class="tag tag-accent">approved</span>' : '<span class="tag tag-neutral">pending</span>',
          u.telegram_linked ? '<span class="tag tag-neutral">telegram</span>' : '',
          u.onesignal_linked ? '<span class="tag tag-neutral">push</span>' : '',
        ].join(' ');
        tr.innerHTML =
          '<td>' + u.email + (u.approved ? '' : ' <button class="btn btn-ghost btn-sm" data-approve="' + u.id + '">Approve</button>') + '</td>' +
          '<td>' + (u.is_admin ? 'Admin' : 'User') + '</td>' +
          '<td class="num">' + u.alert_count + '</td>' +
          '<td>' + tags + '</td>';
        ul.appendChild(tr);
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
  var TRIGGER_POLL_MS = 45000;
  var triggerSeen = null;
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
      if (!$('#view-alerts').classList.contains('hidden')) renderAlerts();
      if (!$('#view-desk').classList.contains('hidden')) renderDesk();

      var fresh = {};
      alerts.forEach(function (a) {
        if (a.last_triggered_at) fresh[a.id] = a.last_triggered_at;
      });

      if (triggerSeen === null) { triggerSeen = fresh; return; }

      var fired = alerts.filter(function (a) {
        if (!a.last_triggered_at) return false;
        var prev = triggerSeen[a.id];
        return !prev || new Date(a.last_triggered_at) > new Date(prev);
      });
      triggerSeen = fresh;

      if (fired.length) {
        var names = fired.map(function (a) { return a.symbol; }).join(', ');
        toast('Alert fired: ' + names, 'ok');
        if (soundOn()) chime();
      }
    }).catch(function () { /* transient — try again next tick */ });
  }

  /* ---------- Wiring ---------- */
  function init() {
    var tick = CFG.POLL_TICK_LABEL || 'every minute';
    $('#landing-tick').textContent = tick;
    $('#dash-tick').textContent = tick;
    $('#today-date').textContent = new Date().toLocaleDateString(undefined, {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });

    identity.on('init', function () { bootstrap(); });
    identity.on('login', function () { identity.close(); bootstrap(); });
    identity.on('logout', function () { state.me = null; bootstrap(); });
    identity.init();

    $('#btn-login').onclick = function () { identity.open('login'); };
    $('#btn-login-2').onclick = function () { identity.open('login'); };
    $('#btn-signup-2').onclick = function () { identity.open('signup'); };
    $('#btn-logout').onclick = function () { identity.logout(); };
    $('#btn-logout-2').onclick = function () { identity.logout(); };
    $('#btn-refresh-status').onclick = function () { bootstrap(); };

    $$('.tab-btn').forEach(function (b) {
      b.onclick = function () { goto(b.dataset.view); };
    });
    $$('[data-goto]').forEach(function (b) {
      b.onclick = function () { goto(b.dataset.goto); };
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
      var type = ($('input[name=wtype]:checked') || {}).value || 'forex';
      addWatch(sym, type).then(function () { $('#watch-symbol').value = ''; });
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
    $$('#chart-intervals input').forEach(function (r) {
      r.onchange = function () { setChartInterval(r.dataset.iv); };
    });

    // Position calculator
    $('#calc-form').onsubmit = calcSubmit;
    $('#calc-reset').onclick = calcReset;
    $('#calc-symbol').onchange = calcPrefill;

    // In-page sound alert
    var sndToggle = $('#snd-toggle');
    if (sndToggle) {
      sndToggle.checked = soundOn();
      $('#snd-status-tag').textContent = soundOn() ? 'On' : 'Off';
      sndToggle.onchange = function () {
        setSoundOn(sndToggle.checked);
        $('#snd-status-tag').textContent = sndToggle.checked ? 'On' : 'Off';
        renderDesk();
        if (sndToggle.checked) chime();
      };
      $('#snd-test').onclick = function () { ensureAudio(); chime(); };
    }
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && triggerTimer) pollTriggers();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
