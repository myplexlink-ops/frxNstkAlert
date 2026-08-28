// Public frontend config (safe to expose). Edit for your deployment.
window.APP_CONFIG = {
  // OneSignal application ID (public value from the OneSignal dashboard).
  ONESIGNAL_APP_ID: 'b06c8e23-aea0-4edf-a284-be14f3ef3b09',

  // How often the alert engine wakes up. Purely cosmetic copy for the UI.
  POLL_TICK_LABEL: 'every minute',

  // Starter watchlist offered to brand-new users.
  STARTER_SYMBOLS: [
    { symbol: 'EUR/USD', asset_type: 'forex' },
    { symbol: 'GBP/USD', asset_type: 'forex' },
    { symbol: 'USD/JPY', asset_type: 'forex' },
    { symbol: 'AUD/USD', asset_type: 'forex' },
    { symbol: 'XAU/USD', asset_type: 'forex' },
    { symbol: 'AAPL', asset_type: 'stock' },
    { symbol: 'MSFT', asset_type: 'stock' },
    { symbol: 'TSLA', asset_type: 'stock' },
    { symbol: 'NVDA', asset_type: 'stock' },
    { symbol: 'AMZN', asset_type: 'stock' },
  ],
};
