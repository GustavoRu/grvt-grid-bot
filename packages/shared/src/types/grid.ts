// Grid configuration — parameters to create a new grid
export interface GridConfig {
  instrument: string; // e.g., "BTC_USDT_Perp"
  upperPrice: number;
  lowerPrice: number;
  gridCount: number; // number of grid levels (2-200)
  gridType: 'arithmetic' | 'geometric';
  direction: GridDirection; // long | short | neutral (like Pionex "Actitud")
  leverage: number; // 1-50
  investmentAmount: number; // in USDT
  stopLoss?: number;      // absolute price — cancel all & close if hit
  takeProfit?: number;    // absolute price — stop grid if hit
  stopLossPct?: number;   // % drop from entry price (e.g. 10 = stop if price falls 10%)
  takeProfitPct?: number; // % rise from entry price (e.g. 15 = stop if price rises 15%)
}

/**
 * Grid direction (Pionex "Actitud"):
 * - long:    buys below current price, profits from price rising
 * - short:   sells above current price, profits from price falling
 * - neutral: places both sides, profits from oscillation regardless of trend
 */
export type GridDirection = 'long' | 'short' | 'neutral';

// Persisted grid state in DB
export interface Grid extends GridConfig {
  id: string;
  status: GridStatus;
  entryPrice: number;      // price at grid creation (Pionex "Precio inicial")
  currentPrice?: number;
  realizedPnl: number;     // grid profit from completed buy→sell rounds
  unrealizedPnl: number;   // position PnL (Pionex "Trend PnL")
  fundingPnl: number;      // cumulative funding rate payments
  totalVolume: number;
  tradeCount: number;      // total completed rounds (Pionex "Rondas acumuladas")
  createdAt: Date;
  updatedAt: Date;
  stoppedAt?: Date;
}

export type GridStatus = 'pending' | 'active' | 'stopped' | 'error' | 'completed';

// A single grid level (price + derived order size)
export interface GridLevel {
  index: number; // 0 = bottom, gridCount-1 = top
  price: number;
  orderSize: number; // contracts/lots to buy/sell at this level
}

// Order tracked in DB
export interface GridOrder {
  id: string;
  gridId: string;
  gridLevel: number; // index into grid levels array
  side: 'buy' | 'sell';
  price: number;
  size: number;
  status: OrderStatus;
  grvtOrderId?: string; // order hash from GRVT
  filledAt?: Date;
  filledPrice?: number;
  createdAt: Date;
}

export type OrderStatus = 'pending' | 'open' | 'filled' | 'cancelled' | 'error';

// A completed round-trip (buy fill + sell fill = profit)
// Pionex calls this a "Ronda" (round)
export interface GridTrade {
  id: string;
  gridId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyPrice: number;
  sellPrice: number;
  size: number;
  profit: number;
  timestamp: Date;
}

// Periodic PnL snapshot
export interface PnlSnapshot {
  id: string;
  gridId: string;
  realizedPnl: number;
  unrealizedPnl: number;
  fundingPnl: number;
  totalPnl: number;
  currentPrice: number;
  timestamp: Date;
}

// Funding rate payment record (Pionex "Historial de financiación")
export interface FundingPayment {
  id: string;
  gridId: string;
  amount: number;      // positive = received, negative = paid
  rate: number;        // funding rate at time of payment
  timestamp: Date;
}

// Computed stats returned by the API (not persisted directly)
export interface GridStats {
  gridId: string;
  totalPnl: number;
  totalPnlPct: number;
  gridPnl: number;          // realized from rounds
  trendPnl: number;         // unrealized from position
  fundingPnl: number;
  aprGrid: number;           // annualized % from grid rounds only
  aprTotal: number;          // annualized % total
  rounds24h: number;         // completed rounds in last 24h
  roundsTotal: number;
  profitPerGridPct: number;  // avg % gain per grid interval
  daysActive: number;
}
