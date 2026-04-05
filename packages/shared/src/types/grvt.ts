// GRVT API types

export type GrvtEnvironment = 'testnet' | 'prod';

export interface GrvtInstrument {
  instrument: string; // e.g., "BTC_USDT_Perp"
  base: string; // "BTC"
  quote: string; // "USDT"
  instrumentType: 'PERPETUAL' | 'FUTURE' | 'SPOT';
  minSize: number;
  maxSize: number;
  tickSize: number; // price tick
  stepSize: number; // quantity step
}

export interface GrvtTicker {
  instrument: string;
  markPrice: number;
  indexPrice: number;
  lastPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  volume24h: number;
  high24h: number;
  low24h: number;
}

export interface GrvtPosition {
  instrument: string;
  size: number; // positive = long, negative = short
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  leverage: number;
  liquidationPrice: number;
}

export interface GrvtOrderRequest {
  instrument: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price?: number;
  size: number;
  timeInForce?: 'GTT' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
  postOnly?: boolean;
}

export interface GrvtOrderResponse {
  orderId: string; // GRVT order hash
  instrument: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filledSize: number;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  createdAt: number; // unix ms
}

// WebSocket message types
export interface WsOrderFill {
  type: 'order_fill';
  orderId: string;
  instrument: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: number;
}

export interface WsMarkPrice {
  type: 'mark_price';
  instrument: string;
  price: number;
  timestamp: number;
}
