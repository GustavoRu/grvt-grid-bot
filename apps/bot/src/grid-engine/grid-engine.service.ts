import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { GrvtExchangeService } from './grvt-exchange.service';
import { GridCalculator } from './grid-calculator';
import type { GridConfig, GridLevel } from '@grvt-grid-bot/shared';

// These types mirror the Prisma-generated types. Defined here to avoid a hard
// dependency on the generated client during typecheck before `prisma generate`.
interface Grid {
  id: string;
  instrument: string;
  upperPrice: number;
  lowerPrice: number;
  gridCount: number;
  gridType: string;
  leverage: number;
  investmentAmount: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: string;
  currentPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  totalVolume: number;
  tradeCount: number;
  createdAt: Date;
  updatedAt: Date;
  stoppedAt: Date | null;
}

interface GridOrder {
  id: string;
  gridId: string;
  gridLevel: number;
  side: string;
  price: number;
  size: number;
  filledPrice: number | null;
  status: string;
  grvtOrderId: string | null;
  filledAt: Date | null;
  createdAt: Date;
}

interface ActiveGrid {
  grid: Grid;
  levels: GridLevel[];
  orderMap: Map<string, GridOrder>; // grvtOrderId → GridOrder
}

@Injectable()
export class GridEngineService {
  private readonly logger = new Logger(GridEngineService.name);
  private activeGrids = new Map<string, ActiveGrid>(); // gridId → ActiveGrid

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly exchange: GrvtExchangeService,
  ) {
    // Listen to price updates to trigger stop-loss checks
    this.marketData.on('price', (update) => this.onPriceUpdate(update));
  }

  /** Start a new grid from config */
  async startGrid(config: GridConfig): Promise<Grid> {
    // Persist grid record
    const grid = await this.prisma.grid.create({
      data: {
        instrument: config.instrument,
        upperPrice: config.upperPrice,
        lowerPrice: config.lowerPrice,
        gridCount: config.gridCount,
        gridType: config.gridType,
        leverage: config.leverage,
        investmentAmount: config.investmentAmount,
        stopLoss: config.stopLoss,
        takeProfit: config.takeProfit,
        status: 'pending',
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalVolume: 0,
        tradeCount: 0,
      },
    });

    this.logger.log(`Starting grid ${grid.id} on ${config.instrument}`);

    try {
      // Set leverage
      await this.exchange.setLeverage(config.instrument, config.leverage);

      // Get current market price
      const ticker = await this.exchange.getTicker(config.instrument);
      const currentPrice = ticker.markPrice;

      // Subscribe to market data
      this.marketData.subscribe(config.instrument);

      // Calculate grid levels
      const levels = GridCalculator.calculateLevels(config);
      const { buyLevels, sellLevels } = GridCalculator.splitLevelsByPrice(levels, currentPrice);

      this.logger.log(
        `Grid levels: ${levels.length} total, ${buyLevels.length} buys, ${sellLevels.length} sells at price ${currentPrice}`,
      );

      // Place initial orders
      const orderMap = new Map<string, GridOrder>();
      await this.placeInitialOrders(grid, buyLevels, sellLevels, orderMap);

      // Activate grid
      const activeGrid = await this.prisma.grid.update({
        where: { id: grid.id },
        data: { status: 'active', currentPrice },
      });

      this.activeGrids.set(grid.id, { grid: activeGrid, levels, orderMap });
      this.logger.log(`✅ Grid ${grid.id} active with ${orderMap.size} orders`);

      return activeGrid;
    } catch (error) {
      await this.prisma.grid.update({ where: { id: grid.id }, data: { status: 'error' } });
      throw error;
    }
  }

  /** Stop and cancel all orders for a grid */
  async stopGrid(gridId: string): Promise<void> {
    const active = this.activeGrids.get(gridId);
    const grid = active?.grid ?? (await this.prisma.grid.findUnique({ where: { id: gridId } }));

    if (!grid) throw new Error(`Grid ${gridId} not found`);

    this.logger.log(`Stopping grid ${gridId}…`);

    try {
      await this.exchange.cancelAllOrders(grid.instrument);
    } catch (err) {
      this.logger.warn(`Failed to cancel orders for grid ${gridId}`, err);
    }

    // Mark open DB orders as cancelled
    await this.prisma.gridOrder.updateMany({
      where: { gridId, status: { in: ['pending', 'open'] } },
      data: { status: 'cancelled' },
    });

    await this.prisma.grid.update({ where: { id: gridId }, data: { status: 'stopped', stoppedAt: new Date() } });

    this.activeGrids.delete(gridId);
    this.marketData.unsubscribe(grid.instrument);
    this.logger.log(`Grid ${gridId} stopped`);
  }

  /** Called when a fill is detected (via WS or polling) */
  async onOrderFilled(grvtOrderId: string, filledPrice: number): Promise<void> {
    // Find which grid this order belongs to
    const filledOrder = await this.prisma.gridOrder.findFirst({
      where: { grvtOrderId, status: 'open' },
      include: { grid: true },
    });

    if (!filledOrder) {
      this.logger.warn(`Received fill for unknown order ${grvtOrderId}`);
      return;
    }

    const { gridId } = filledOrder;

    // Mark order as filled
    await this.prisma.gridOrder.update({
      where: { id: filledOrder.id },
      data: { status: 'filled', filledAt: new Date(), filledPrice },
    });

    const active = this.activeGrids.get(gridId);
    if (!active) return;

    // Grid rebalancing logic:
    // BUY filled → place SELL one level above
    // SELL filled → place BUY one level below
    if (filledOrder.side === 'buy') {
      await this.placeCounterOrder(active, filledOrder, 'sell');
    } else {
      await this.placeCounterOrder(active, filledOrder, 'buy');
      // Record realized profit (sell filled after a buy)
      await this.recordTradeProfit(gridId, filledOrder);
    }

    // Update PnL snapshot
    await this.snapshotPnl(gridId);
  }

  /** Polling fallback: check fill status every 10s for active grids */
  @Interval(10000)
  async pollOrderFills(): Promise<void> {
    for (const [gridId, active] of this.activeGrids) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openOrders: any[] = await this.exchange.getOpenOrders(active.grid.instrument);
        const openOrderIds = new Set(openOrders.map((o) => o.id as string));

        // Find DB orders that are no longer open on exchange → they filled or were cancelled
        const dbOpenOrders = await this.prisma.gridOrder.findMany({
          where: { gridId, status: 'open' },
        });

        for (const dbOrder of dbOpenOrders) {
          if (dbOrder.grvtOrderId && !openOrderIds.has(dbOrder.grvtOrderId)) {
            this.logger.debug(`Order ${dbOrder.grvtOrderId} no longer open — assuming filled`);
            await this.onOrderFilled(dbOrder.grvtOrderId, dbOrder.price);
          }
        }
      } catch (err) {
        this.logger.warn(`Error polling fills for grid ${gridId}`, err);
      }
    }
  }

  private async placeInitialOrders(
    grid: Grid,
    buyLevels: GridLevel[],
    sellLevels: GridLevel[],
    orderMap: Map<string, GridOrder>,
  ): Promise<void> {
    const allLevels = [
      ...buyLevels.map((l) => ({ ...l, side: 'buy' as const })),
      ...sellLevels.map((l) => ({ ...l, side: 'sell' as const })),
    ];

    for (const level of allLevels) {
      try {
        const response = await this.exchange.placeOrder({
          instrument: grid.instrument,
          side: level.side,
          type: 'limit',
          price: level.price,
          size: level.orderSize,
          timeInForce: 'GTC',
          postOnly: true,
        });

        const dbOrder = await this.prisma.gridOrder.create({
          data: {
            gridId: grid.id,
            gridLevel: level.index,
            side: level.side,
            price: level.price,
            size: level.orderSize,
            status: 'open',
            grvtOrderId: response.orderId,
          },
        });

        orderMap.set(response.orderId, dbOrder);

        // Small delay to respect rate limits
        await this.sleep(100);
      } catch (err) {
        this.logger.warn(`Failed to place ${level.side} @ ${level.price}`, err);
      }
    }
  }

  private async placeCounterOrder(
    active: ActiveGrid,
    filledOrder: GridOrder,
    side: 'buy' | 'sell',
  ): Promise<void> {
    const counterIndex = side === 'sell' ? filledOrder.gridLevel + 1 : filledOrder.gridLevel - 1;
    const counterLevel = active.levels[counterIndex];
    if (!counterLevel) return; // at the edge of the grid

    try {
      const response = await this.exchange.placeOrder({
        instrument: active.grid.instrument,
        side,
        type: 'limit',
        price: counterLevel.price,
        size: counterLevel.orderSize,
        timeInForce: 'GTC',
        postOnly: true,
      });

      const dbOrder = await this.prisma.gridOrder.create({
        data: {
          gridId: active.grid.id,
          gridLevel: counterLevel.index,
          side,
          price: counterLevel.price,
          size: counterLevel.orderSize,
          status: 'open',
          grvtOrderId: response.orderId,
        },
      });

      active.orderMap.set(response.orderId, dbOrder);
      this.logger.debug(`Placed counter ${side} @ ${counterLevel.price}`);
    } catch (err) {
      this.logger.error(`Failed to place counter ${side} order`, err);
    }
  }

  private async recordTradeProfit(gridId: string, sellOrder: GridOrder): Promise<void> {
    // Find the corresponding buy order at the level below
    const buyOrder = await this.prisma.gridOrder.findFirst({
      where: { gridId, gridLevel: sellOrder.gridLevel - 1, side: 'buy', status: 'filled' },
      orderBy: { filledAt: 'desc' },
    });

    if (!buyOrder) return;

    const profit = (sellOrder.price - buyOrder.price) * sellOrder.size;

    await this.prisma.gridTrade.create({
      data: {
        gridId,
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        buyPrice: buyOrder.price,
        sellPrice: sellOrder.price,
        size: sellOrder.size,
        profit,
      },
    });

    await this.prisma.grid.update({
      where: { id: gridId },
      data: {
        realizedPnl: { increment: profit },
        totalVolume: { increment: sellOrder.price * sellOrder.size },
        tradeCount: { increment: 1 },
      },
    });

    this.logger.log(`Trade profit: +$${profit.toFixed(4)} (${buyOrder.price} → ${sellOrder.price})`);
  }

  private async snapshotPnl(gridId: string): Promise<void> {
    const grid = await this.prisma.grid.findUnique({ where: { id: gridId } });
    if (!grid) return;

    await this.prisma.pnlSnapshot.create({
      data: {
        gridId,
        realizedPnl: grid.realizedPnl,
        unrealizedPnl: grid.unrealizedPnl,
        totalPnl: grid.realizedPnl + grid.unrealizedPnl,
        currentPrice: grid.currentPrice ?? 0,
      },
    });
  }

  private onPriceUpdate(update: { instrument: string; markPrice: number }): void {
    for (const [gridId, active] of this.activeGrids) {
      if (active.grid.instrument !== update.instrument) continue;

      const price = update.markPrice;

      // Update current price in DB (throttle: only if changed > 0.1%)
      const lastPrice = active.grid.currentPrice ?? 0;
      if (Math.abs(price - lastPrice) / lastPrice > 0.001) {
        this.prisma.grid.update({ where: { id: gridId }, data: { currentPrice: price } }).catch(() => {});
        active.grid = { ...active.grid, currentPrice: price };
      }

      // Stop loss check
      const stopLoss = active.grid.stopLoss;
      if (stopLoss && (price <= stopLoss)) {
        this.logger.warn(`🛑 Stop loss triggered for grid ${gridId} at ${price} (SL: ${stopLoss})`);
        this.stopGrid(gridId).catch((err) => this.logger.error('Failed to stop grid on SL', err));
      }

      // Take profit check
      const takeProfit = active.grid.takeProfit;
      if (takeProfit && price >= takeProfit) {
        this.logger.log(`✅ Take profit triggered for grid ${gridId} at ${price} (TP: ${takeProfit})`);
        this.stopGrid(gridId).catch((err) => this.logger.error('Failed to stop grid on TP', err));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
