export const GRVT_ENDPOINTS = {
  prod: {
    http: 'https://edge.grvt.io',
    wsMarket: 'wss://market-data.grvt.io/ws/full',
    wsTrading: 'wss://trades.grvt.io/ws/full',
  },
  testnet: {
    http: 'https://edge.testnet.grvt.io',
    wsMarket: 'wss://market-data.testnet.grvt.io/ws/full',
    wsTrading: 'wss://trades.testnet.grvt.io/ws/full',
  },
} as const;

export const GRID_CONSTRAINTS = {
  minGridCount: 2,
  maxGridCount: 200,
  minLeverage: 1,
  maxLeverage: 50,
  minInvestmentUsdt: 10,
  // Minimum price distance between grid levels (%)
  minGridSpacingPct: 0.001, // 0.1%
} as const;

export const DEFAULT_GRID_CONFIG = {
  gridCount: 20,
  gridType: 'arithmetic' as const,
  leverage: 2,
};

// Session cookie name used by GRVT
export const GRVT_SESSION_COOKIE = 'gravity';

// How long before cookie expiry to refresh (ms)
export const SESSION_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
