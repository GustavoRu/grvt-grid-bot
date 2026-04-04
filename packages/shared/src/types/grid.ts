// Grid configuration — parameters to create a new grid
export interface GridConfig {
  instrument: string; // e.g., "BTC_USDT_Perp"
  upperPrice: number;
  lowerPrice: number;
  gridCount: number; // number of grid levels (2-200)
  gridType: 'arithmetic' | 'geometric';
  leverage: number; // 1-50
  investmentAmount: number; // in USDT
  stopLoss?: number; // price — cancel all & close if hit
  takeProfit?: number; // price — stop grid if hit
}

// Persisted grid state in DB
export interface Grid extends GridConfig {
  id: string;
  status: GridStatus;
  currentPrice?: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalVolume: number;
  tradeCount: number;
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
  createdAt: Date;
}

export type OrderStatus = 'pending' | 'open' | 'filled' | 'cancelled' | 'error';

// A completed round-trip (buy fill + sell fill = profit)
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
  totalPnl: number;
  currentPrice: number;
  timestamp: Date;
}
