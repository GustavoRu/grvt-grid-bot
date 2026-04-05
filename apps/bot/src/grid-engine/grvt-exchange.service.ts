import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ccxt from 'ccxt';
import type { GrvtInstrument, GrvtOrderRequest, GrvtOrderResponse } from '@grvt-grid-bot/shared';

/**
 * Wraps CCXT grvt exchange instance.
 * Handles order placement, cancellation, and position queries.
 */
@Injectable()
export class GrvtExchangeService implements OnModuleInit {
  private readonly logger = new Logger(GrvtExchangeService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private exchange!: any;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const env = this.config.get<string>('GRVT_ENV') ?? 'testnet';
    // apiKey = GRVT API key (session auth), secret = ETH private key (EIP-712 order signing)
    const apiKey = this.config.getOrThrow<string>('GRVT_API_KEY');
    const privateKey = this.config.getOrThrow<string>('GRVT_PRIVATE_KEY');
    const subAccountId = this.config.getOrThrow<string>('GRVT_SUB_ACCOUNT_ID');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.exchange = new (ccxt as any).grvt({
      apiKey,
      secret: privateKey,
      options: {
        accountId: subAccountId,
        defaultType: 'swap',
      },
    });

    if (env !== 'prod') {
      this.exchange.setSandboxMode(true);
    }

    // CCXT grvt quirk: requiredCredentials marks privateKey as required, but when
    // using apiKey auth the private key goes in `secret` for EIP-712 order signing.
    this.exchange.requiredCredentials.privateKey = false;

    this.logger.log(`GRVT CCXT exchange initialized (${env})`);
  }

  /** Fetch all available perpetual instruments */
  async getInstruments(): Promise<GrvtInstrument[]> {
    const markets = await this.exchange.loadMarkets();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (Object.values(markets) as any[])
      .filter((m) => m.type === 'swap' || m.info?.instrument_type === 'PERPETUAL')
      .map((m) => ({
        instrument: m.id as string,
        base: m.base as string,
        quote: m.quote as string,
        instrumentType: 'PERPETUAL' as const,
        minSize: (m.limits?.amount?.min as number) ?? 0,
        maxSize: (m.limits?.amount?.max as number) ?? Number.MAX_SAFE_INTEGER,
        tickSize: (m.precision?.price as number) ?? 0.1,
        stepSize: (m.precision?.amount as number) ?? 0.0001,
      }));
  }

  /** Fetch mark price for an instrument */
  async getTicker(instrument: string): Promise<{ markPrice: number; lastPrice: number }> {
    // CCXT uses slash format: BTC/USDT:USDT
    const symbol = this.toSymbol(instrument);
    const ticker = await this.exchange.fetchTicker(symbol);
    return {
      markPrice: ticker.mark ?? ticker.last ?? 0,
      lastPrice: ticker.last ?? 0,
    };
  }

  /** Get minimum order size for an instrument */
  async getMinOrderSize(instrument: string): Promise<number> {
    const markets = await this.exchange.loadMarkets();
    const symbol = this.toSymbol(instrument);
    const market = markets[symbol];
    return (market?.limits?.amount?.min as number | undefined) ?? 0;
  }

  /** Place a limit order */
  async placeOrder(req: GrvtOrderRequest): Promise<GrvtOrderResponse> {
    const symbol = this.toSymbol(req.instrument);
    // GRVT requires GTT/IOC/FOK — GTT is the GTC equivalent (needs expiry)
    const tif = req.timeInForce ?? 'GTT';
    const params: Record<string, unknown> = {
      timeInForce: tif,
      ...(tif === 'GTT' ? { expiry: Date.now() + 90 * 24 * 60 * 60 * 1000 } : {}),
      postOnly: req.postOnly ?? false,
      reduceOnly: req.reduceOnly ?? false,
    };

    this.logger.debug(
      `Placing ${req.side} ${req.type} order: ${req.size} @ ${req.price} on ${req.instrument}`,
    );

    const order = await this.exchange.createOrder(
      symbol,
      req.type,
      req.side,
      req.size,
      req.price,
      params,
    );

    return {
      orderId: order.id,
      instrument: req.instrument,
      side: req.side,
      price: order.price ?? req.price ?? 0,
      size: order.amount,
      filledSize: order.filled ?? 0,
      status: this.mapOrderStatus(order.status ?? 'open'),
      createdAt: order.timestamp ?? Date.now(),
    };
  }

  /** Cancel a single order */
  async cancelOrder(orderId: string, instrument: string): Promise<void> {
    const symbol = this.toSymbol(instrument);
    await this.exchange.cancelOrder(orderId, symbol);
    this.logger.debug(`Cancelled order ${orderId}`);
  }

  /** Cancel all open orders for an instrument */
  async cancelAllOrders(instrument: string): Promise<void> {
    const symbol = this.toSymbol(instrument);
    await this.exchange.cancelAllOrders(symbol);
    this.logger.log(`Cancelled all orders for ${instrument}`);
  }

  /** Fetch open orders for an instrument */
  async getOpenOrders(instrument: string) {
    const symbol = this.toSymbol(instrument);
    return this.exchange.fetchOpenOrders(symbol);
  }

  /** Fetch current position for an instrument */
  async getPosition(instrument: string) {
    const symbol = this.toSymbol(instrument);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positions: any[] = await this.exchange.fetchPositions([symbol]);
    return positions.find((p) => p.symbol === symbol) ?? null;
  }

  /** Set leverage for an instrument */
  async setLeverage(instrument: string, leverage: number): Promise<void> {
    const symbol = this.toSymbol(instrument);
    await this.exchange.setLeverage(leverage, symbol);
    this.logger.log(`Set leverage ${leverage}x for ${instrument}`);
  }

  /** Convert GRVT instrument format to CCXT symbol */
  private toSymbol(instrument: string): string {
    // BTC_USDT_Perp → BTC/USDT:USDT
    const parts = instrument.split('_');
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}:${parts[1]}`;
    }
    return instrument;
  }

  private mapOrderStatus(
    status: string,
  ): 'PENDING' | 'OPEN' | 'FILLED' | 'CANCELLED' | 'REJECTED' {
    switch (status) {
      case 'open':
        return 'OPEN';
      case 'closed':
        return 'FILLED';
      case 'canceled':
      case 'cancelled':
        return 'CANCELLED';
      case 'rejected':
        return 'REJECTED';
      default:
        return 'PENDING';
    }
  }
}
