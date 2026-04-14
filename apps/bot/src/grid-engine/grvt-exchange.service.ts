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

  async onModuleInit() {
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
        // CCXT default is 30s — far too short for grid orders.
        // GRVT maximum signature expiry is 30 days (2,592,000 seconds).
        expirationSeconds: 2592000,
      },
    });

    if (env !== 'prod') {
      this.exchange.setSandboxMode(true);
    }

    // CCXT grvt quirk: requiredCredentials marks privateKey as required, but when
    // using apiKey auth the private key goes in `secret` for EIP-712 order signing.
    this.exchange.requiredCredentials.privateKey = false;

    this.logger.log(`GRVT CCXT exchange initialized (${env})`);

    // With API key auth, CCXT's signIn() skips initializeClient() — the step that
    // authorizes GRVT's order builder on behalf of the user. Without it, all orders
    // fail with code 7504 "Builder is not authorized". Call it explicitly here.
    try {
      const markets = await this.exchange.loadMarkets();    // triggers signIn (API key auth)
      const swapSymbols = Object.keys(markets).filter((s) => markets[s].type === 'swap' || markets[s].linear);
      this.logger.log(`Loaded ${Object.keys(markets).length} markets, ${swapSymbols.length} swaps/perps: ${swapSymbols.slice(0, 5).join(', ')}`);
      await this.exchange.initializeClient(); // authorizes the CCXT builder via EIP-712
      this.logger.log('GRVT builder authorization confirmed');
    } catch (err) {
      this.logger.warn('Builder authorization failed — orders may be rejected', err);
    }
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

  /** Get exchange constraints for an instrument */
  async getMarketLimits(instrument: string): Promise<{ minAmount: number; minNotional: number }> {
    const markets = await this.exchange.loadMarkets();
    const symbol = this.toSymbol(instrument);
    const market = markets[symbol];
    const minAmount = (market?.limits?.amount?.min as number | undefined) ?? 0;
    const rawMinNotional = (market?.limits?.cost?.min as number | undefined) ?? 0;
    // GRVT enforces a notional floor that may exceed what CCXT reports.
    // Apply a 5% safety buffer (20 → 21) to prevent borderline orders from being rejected.
    const minNotional = rawMinNotional > 0 ? Math.ceil(rawMinNotional * 1.05) : 21;
    this.logger.debug(`Market limits for ${instrument}: minAmount=${minAmount}, rawMinNotional=${rawMinNotional}, effectiveMinNotional=${minNotional}`);
    return { minAmount, minNotional };
  }

  /** Place a limit order */
  async placeOrder(req: GrvtOrderRequest): Promise<GrvtOrderResponse> {
    const symbol = this.toSymbol(req.instrument);
    // CCXT maps GTC → GOOD_TILL_TIME for GRVT. Do NOT pass postOnly: when postOnly=true
    // CCXT skips setting time_in_force entirely, causing GRVT to reject with code 2030.
    const params: Record<string, unknown> = {
      timeInForce: req.timeInForce ?? 'GTC',
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

  /** Fetch a single order by ID — used to distinguish fill vs cancel */
  async getOrder(orderId: string, instrument: string) {
    const symbol = this.toSymbol(instrument);
    return this.exchange.fetchOrder(orderId, symbol);
  }

  /** Fetch recent closed/cancelled orders — used to detect fills during initial placement */
  async getRecentOrders(instrument: string) {
    const symbol = this.toSymbol(instrument);
    // Fetch last 50 orders (open + closed) to find recently filled ones
    return this.exchange.fetchOrders(symbol, undefined, 50);
  }

  /** Fetch current position for an instrument */
  async getPosition(instrument: string) {
    const symbol = this.toSymbol(instrument);
    // fetchPositions() without symbol filter — CCXT grvt rejects per-symbol calls
    // with "supports contract markets only" even for valid swap symbols.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const positions: any[] = await this.exchange.fetchPositions();
    return positions.find((p) => p.symbol === symbol) ?? null;
  }

  /** Set leverage for an instrument */
  async setLeverage(instrument: string, leverage: number): Promise<void> {
    const symbol = this.toSymbol(instrument);
    try {
      // Pass type:'swap' explicitly — CCXT grvt otherwise may resolve the symbol as spot
      await this.exchange.setLeverage(leverage, symbol, { type: 'swap' });
      this.logger.log(`Set leverage ${leverage}x for ${instrument}`);
    } catch (e: unknown) {
      this.logger.warn(`setLeverage failed for ${instrument}: ${e instanceof Error ? e.message : String(e)}`);
      // Non-fatal: leverage must be set manually in GRVT UI before placing orders
    }
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
