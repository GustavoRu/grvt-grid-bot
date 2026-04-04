import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { GRVT_ENDPOINTS } from '@grvt-grid-bot/shared';
import type { GrvtEnvironment, GrvtTicker } from '@grvt-grid-bot/shared';

export interface PriceUpdate {
  instrument: string;
  markPrice: number;
  indexPrice: number;
  timestamp: number;
}

@Injectable()
export class MarketDataService extends EventEmitter implements OnModuleDestroy {
  private readonly logger = new Logger(MarketDataService.name);
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private prices = new Map<string, PriceUpdate>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = 1000;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get wsUrl(): string {
    const env = (this.config.get<string>('GRVT_ENV') ?? 'testnet') as GrvtEnvironment;
    return GRVT_ENDPOINTS[env].wsMarket;
  }

  subscribe(instrument: string): void {
    this.subscriptions.add(instrument);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(instrument);
    } else {
      this.connect();
    }
  }

  unsubscribe(instrument: string): void {
    this.subscriptions.delete(instrument);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          op: 'unsubscribe',
          args: [`mini.${instrument}`],
        }),
      );
    }
  }

  getPrice(instrument: string): PriceUpdate | undefined {
    return this.prices.get(instrument);
  }

  getMarkPrice(instrument: string): number | undefined {
    return this.prices.get(instrument)?.markPrice;
  }

  private connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.logger.log(`Connecting to market data WS: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => {
      this.logger.log('Market data WebSocket connected');
      this.reconnectDelay = 1000;
      // Re-subscribe all active instruments
      for (const instrument of this.subscriptions) {
        this.sendSubscription(instrument);
      }
    });

    this.ws.on('message', (data) => {
      try {
        this.handleMessage(JSON.parse(data.toString()));
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on('close', (code) => {
      this.logger.warn(`Market data WS closed (${code}), reconnecting in ${this.reconnectDelay}ms…`);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.logger.error('Market data WS error', err.message);
    });
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // GRVT mini ticker channel: { channel: "mini.BTC_USDT_Perp", data: {...} }
    if (msg['channel'] && typeof msg['channel'] === 'string') {
      const channel = msg['channel'] as string;
      if (channel.startsWith('mini.')) {
        const instrument = channel.replace('mini.', '');
        const data = msg['data'] as Record<string, unknown>;
        if (data && typeof data['mark_price'] === 'string') {
          const update: PriceUpdate = {
            instrument,
            markPrice: parseFloat(data['mark_price'] as string),
            indexPrice: parseFloat((data['index_price'] as string) ?? '0'),
            timestamp: Date.now(),
          };
          this.prices.set(instrument, update);
          this.emit('price', update);
        }
      }
    }
  }

  private sendSubscription(instrument: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        op: 'subscribe',
        args: [`mini.${instrument}`],
      }),
    );
    this.logger.debug(`Subscribed to mini.${instrument}`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }

  onModuleDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
