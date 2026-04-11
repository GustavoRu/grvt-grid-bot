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
  direction: string;
  leverage: number;
  investmentAmount: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: string;
  entryPrice: number;
  currentPrice: number | null;
  realizedPnl: number;
  unrealizedPnl: number;
  fundingPnl: number;
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
  windowLow: number;    // lowest level index currently in active window
  windowHigh: number;   // highest level index currently in active window
  rebalancing: boolean; // lock to prevent concurrent sliding-window rebalances
}

// GRVT enforces a hard limit on open orders per sub-account per instrument.
// Tier 1 (default / testnet) = 20. Adjust if account is a higher tier.
const MAX_OPEN_ORDERS = 20;

@Injectable()
export class GridEngineService {
  private readonly logger = new Logger(GridEngineService.name);
  private activeGrids = new Map<string, ActiveGrid>(); // gridId → ActiveGrid
  // Prevents double-processing when the 10s poller fires twice for the same fill
  private processingFills = new Set<string>(); // grvtOrderId

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly exchange: GrvtExchangeService,
  ) {
    // Listen to price updates to trigger stop-loss / sliding window
    this.marketData.on('price', (update) => this.onPriceUpdate(update));
    // Clean up orphaned orders from failed/error grids on startup
    this.pruneStaleOrders()
      .then(() => this.recoverActiveGrids())
      .catch((err) => this.logger.error('Startup recovery failed', err));
  }

  /** Remove open orders in DB that belong to grids in error/stopped state.
   *  Prevents grvtOrderId unique constraint failures on restart. */
  private async pruneStaleOrders(): Promise<void> {
    const result = await this.prisma.gridOrder.deleteMany({
      where: {
        status: { in: ['pending', 'open', 'error'] },
        grid: { status: { in: ['error', 'stopped', 'completed'] } },
      },
    });
    if (result.count > 0) {
      this.logger.log(`Pruned ${result.count} stale orders from non-active grids`);
    }
  }

  /**
   * On startup, reload any grids that were 'active' when the process died.
   * For each:
   *   1. Recalculate grid levels from stored config
   *   2. Fetch currently open orders from exchange
   *   3. Rebuild orderMap and window boundaries
   *   4. Re-subscribe to market data so the sliding window keeps running
   *
   * Orders that are open on exchange but missing from DB (e.g. placed before crash
   * and not yet reconciled) are cancelled to avoid ghost positions.
   */
  private async recoverActiveGrids(): Promise<void> {
    const activeGrids = await this.prisma.grid.findMany({
      where: { status: 'active' },
    });

    if (activeGrids.length === 0) return;
    this.logger.log(`Recovering ${activeGrids.length} active grid(s) from DB…`);

    for (const grid of activeGrids) {
      try {
        const config: GridConfig = {
          instrument: grid.instrument,
          upperPrice: grid.upperPrice,
          lowerPrice: grid.lowerPrice,
          gridCount: grid.gridCount,
          gridType: grid.gridType as 'arithmetic' | 'geometric',
          direction: grid.direction as 'long' | 'short' | 'neutral',
          leverage: grid.leverage,
          investmentAmount: grid.investmentAmount,
          stopLoss: grid.stopLoss ?? undefined,
          takeProfit: grid.takeProfit ?? undefined,
        };

        // Recalculate levels (same deterministic formula)
        const { minAmount, minNotional } = await this.exchange.getMarketLimits(grid.instrument);
        const levels = GridCalculator.calculateLevels(config, minAmount, minNotional);

        // Fetch what's actually open on exchange right now
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openOrders: any[] = await this.exchange.getOpenOrders(grid.instrument);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const exchangeByKey = new Map<string, any>();
        for (const o of openOrders) {
          const key = `${o.side}@${parseFloat(o.price).toFixed(1)}`;
          exchangeByKey.set(key, o);
        }

        // Fetch DB open orders for this grid
        const dbOpenOrders = await this.prisma.gridOrder.findMany({
          where: { gridId: grid.id, status: { in: ['open', 'pending'] } },
        });

        // Fetch recent order history ONCE to detect fills that occurred during downtime.
        // Orders that filled while the bot was down won't appear in fetchOpenOrders.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recentOrders: any[] = await this.exchange.getRecentOrders(grid.instrument).catch(() => []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recentFillsByKey = new Map<string, any>();
        for (const o of recentOrders) {
          if (o.status === 'closed') {
            const rKey = `${o.side as string}@${parseFloat(o.price as string).toFixed(1)}`;
            if (!recentFillsByKey.has(rKey)) recentFillsByKey.set(rKey, o); // keep most recent per level
          }
        }

        // Rebuild orderMap: match DB orders to exchange orders
        const orderMap = new Map<string, GridOrder>();
        for (const dbOrder of dbOpenOrders) {
          const key = `${dbOrder.side}@${dbOrder.price.toFixed(1)}`;
          const match = exchangeByKey.get(key);
          if (match?.id && !/^0x0+$/.test(match.id)) {
            // Update DB with real ID if it was null (pending before crash)
            if (!dbOrder.grvtOrderId || dbOrder.grvtOrderId !== match.id) {
              await this.prisma.gridOrder.update({
                where: { id: dbOrder.id },
                data: { grvtOrderId: match.id, status: 'open' },
              });
            }
            orderMap.set(match.id, { ...dbOrder, grvtOrderId: match.id, status: 'open' });
            exchangeByKey.delete(key);
          } else {
            // Not in open orders — check if it filled during downtime before marking cancelled.
            // If marked 'cancelled', recordTradeProfit can't pair it with its counter order later.
            const recentFill = recentFillsByKey.get(key);
            if (recentFill?.id) {
              const filledPrice = parseFloat(recentFill.average ?? recentFill.price ?? String(dbOrder.price));
              await this.prisma.gridOrder.update({
                where: { id: dbOrder.id },
                data: { status: 'filled', filledAt: new Date(), filledPrice, grvtOrderId: recentFill.id as string },
              });
              this.logger.log(`Recovery: ${dbOrder.side}@${dbOrder.price} filled during downtime @ ${filledPrice}`);
            } else {
              await this.prisma.gridOrder.update({
                where: { id: dbOrder.id },
                data: { status: 'cancelled' },
              });
            }
          }
        }

        // Any exchange orders not matched to DB records are unknown — cancel them
        for (const [key, o] of exchangeByKey) {
          this.logger.warn(`Recovery: unknown exchange order ${o.id} @ ${key} — cancelling`);
          await this.exchange.cancelOrder(o.id, grid.instrument).catch(() => {});
        }

        // Recompute window boundaries from current open orders
        const openLevels = [...orderMap.values()].map((o) => o.gridLevel);
        const windowLow  = openLevels.length > 0 ? Math.min(...openLevels) : 0;
        const windowHigh = openLevels.length > 0 ? Math.max(...openLevels) : levels.length - 1;

        // Re-subscribe to market data
        this.marketData.subscribe(grid.instrument);

        this.activeGrids.set(grid.id, {
          grid,
          levels,
          orderMap,
          windowLow,
          windowHigh,
          rebalancing: false,
        });

        this.logger.log(
          `Recovered grid ${grid.id}: ${orderMap.size} orders active (window ${windowLow}–${windowHigh})`,
        );

        // Immediately rebalance window to fill any gaps left by the downtime
        const ticker = await this.exchange.getTicker(grid.instrument);
        await this.rebalanceWindow(grid.id, this.activeGrids.get(grid.id)!, ticker.markPrice);
      } catch (err) {
        this.logger.error(`Failed to recover grid ${grid.id}`, err);
      }
    }
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
        direction: config.direction ?? 'long',
        leverage: config.leverage,
        investmentAmount: config.investmentAmount,
        stopLoss: config.stopLoss,
        takeProfit: config.takeProfit,
        status: 'pending',
        entryPrice: 0, // set after fetching market price
        realizedPnl: 0,
        unrealizedPnl: 0,
        fundingPnl: 0,
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

      // Resolve percentage-based SL/TP to absolute prices now that we have the entry price
      const resolvedStopLoss = config.stopLoss ?? (config.stopLossPct ? currentPrice * (1 - config.stopLossPct / 100) : undefined);
      const resolvedTakeProfit = config.takeProfit ?? (config.takeProfitPct ? currentPrice * (1 + config.takeProfitPct / 100) : undefined);
      if (resolvedStopLoss || resolvedTakeProfit) {
        await this.prisma.grid.update({
          where: { id: grid.id },
          data: { stopLoss: resolvedStopLoss, takeProfit: resolvedTakeProfit },
        });
        if (resolvedStopLoss) this.logger.log(`Stop loss set at $${resolvedStopLoss.toFixed(1)} (${config.stopLossPct ? config.stopLossPct + '%' : 'absolute'})`);
        if (resolvedTakeProfit) this.logger.log(`Take profit set at $${resolvedTakeProfit.toFixed(1)} (${config.takeProfitPct ? config.takeProfitPct + '%' : 'absolute'})`);
      }

      // Subscribe to market data
      this.marketData.subscribe(config.instrument);

      // Calculate grid levels — fetch exchange limits to clamp by amount AND notional
      const { minAmount, minNotional } = await this.exchange.getMarketLimits(config.instrument);
      const capitalPerGrid = (config.investmentAmount * config.leverage) / config.gridCount;
      if (minNotional > 0 && capitalPerGrid < minNotional) {
        const minInvestment = Math.ceil((minNotional * config.gridCount) / config.leverage);
        throw new Error(
          `Investment too low: $${capitalPerGrid.toFixed(2)}/grid < $${minNotional} minimum notional. ` +
          `Need at least $${minInvestment} with ${config.leverage}x leverage for ${config.gridCount} grids.`,
        );
      }
      this.logger.log(`Capital per grid: $${capitalPerGrid.toFixed(2)} (min notional: $${minNotional})`);
      const levels = GridCalculator.calculateLevels(config, minAmount, minNotional);
      const { buyLevels, sellLevels } = GridCalculator.splitLevelsByPrice(levels, currentPrice);

      this.logger.log(
        `Grid levels: ${levels.length} total, ${buyLevels.length} buys, ${sellLevels.length} sells at price ${currentPrice}`,
      );

      // Direction determines which initial orders to place:
      //
      //  long    → only BUY orders below current price. Sells are placed only after
      //            a buy fills (counter order), so there is never net short exposure.
      //            This mirrors how Pionex "Largo" futures grid works.
      //
      //  short   → only SELL orders above current price. Buys only as counter orders.
      //
      //  neutral → both sides (current Pionex "Neutral" behavior). Sells above can
      //            open short exposure when filled before paired buys exist.
      //
      // GRVT limits open orders per instrument (Tier 1 = 20).
      const direction = config.direction ?? 'long';
      const slotsPerSide = Math.floor(MAX_OPEN_ORDERS / 2);

      const activeBuys: GridLevel[] = direction !== 'short'
        ? buyLevels.slice(-MAX_OPEN_ORDERS)        // long/neutral: up to 20 buys below price
        : [];
      const activeSells: GridLevel[] = direction !== 'long'
        ? sellLevels.slice(0, MAX_OPEN_ORDERS)     // short/neutral: up to 20 sells above price
        : [];

      // For neutral, cap each side to slotsPerSide so total stays within MAX_OPEN_ORDERS
      const finalBuys  = direction === 'neutral' ? activeBuys.slice(-slotsPerSide)  : activeBuys;
      const finalSells = direction === 'neutral' ? activeSells.slice(0, slotsPerSide) : activeSells;

      this.logger.log(
        `Order window [${direction}]: ${finalBuys.length} buys (${finalBuys[0]?.price}–${finalBuys.at(-1)?.price}) + ` +
        `${finalSells.length} sells (${finalSells[0]?.price}–${finalSells.at(-1)?.price}) [limit: ${MAX_OPEN_ORDERS}]`,
      );

      // Place initial orders
      const orderMap = new Map<string, GridOrder>();
      await this.placeInitialOrders(grid, finalBuys, finalSells, orderMap);

      // Activate grid — set entryPrice = currentPrice at start (Pionex "Precio inicial")
      const activeGrid = await this.prisma.grid.update({
        where: { id: grid.id },
        data: { status: 'active', currentPrice, entryPrice: currentPrice },
      });

      // Track the active window boundaries so the sliding window knows what to shift.
      // For long: window only covers buy side initially; sells get added as fills come in.
      // For short: window only covers sell side initially.
      const windowLow  = finalBuys[0]?.index  ?? (finalSells[0]?.index ?? 0);
      const windowHigh = finalSells.at(-1)?.index ?? (finalBuys.at(-1)?.index ?? levels.length - 1);

      this.activeGrids.set(grid.id, { grid: activeGrid, levels, orderMap, windowLow, windowHigh, rebalancing: false });
      this.logger.log(`✅ Grid ${grid.id} active with ${orderMap.size} orders (window: levels ${windowLow}–${windowHigh})`);

      return activeGrid;
    } catch (error) {
      await this.prisma.grid.update({ where: { id: grid.id }, data: { status: 'error' } });
      throw error;
    }
  }

  /**
   * Update the price range (and optionally gridCount) of an active grid.
   * Cancels all open orders, recalculates levels with the new config, and
   * places a fresh window of orders. PnL history and trade count are preserved.
   */
  async updateGridRange(
    gridId: string,
    patch: { lowerPrice: number; upperPrice: number; gridCount?: number },
  ): Promise<Grid> {
    const active = this.activeGrids.get(gridId);
    if (!active) throw new Error(`Grid ${gridId} is not active`);

    const { lowerPrice, upperPrice, gridCount = active.grid.gridCount } = patch;

    if (lowerPrice >= upperPrice) throw new Error('lowerPrice must be less than upperPrice');

    // Validate capital-per-grid against min notional before touching exchange
    const { minAmount, minNotional } = await this.exchange.getMarketLimits(active.grid.instrument);
    const capitalPerGrid = (active.grid.investmentAmount * active.grid.leverage) / gridCount;
    if (minNotional > 0 && capitalPerGrid < minNotional) {
      const maxGrids = Math.floor((active.grid.investmentAmount * active.grid.leverage) / minNotional);
      throw new Error(
        `Investment too low: $${capitalPerGrid.toFixed(2)}/grid < $${minNotional} minimum. ` +
        `Max grids with current investment: ${maxGrids}.`,
      );
    }

    this.logger.log(`Updating range for grid ${gridId}: [${lowerPrice}–${upperPrice}] ${gridCount} grids`);

    // Detect filled buys that have no counter sell yet (orphaned fills).
    // These happened between the last fill event and this range update — we need
    // to place a sell for each one in the new range so positions are covered.
    const filledBuysWithoutSell = await this.prisma.gridOrder.findMany({
      where: { gridId, side: 'buy', status: 'filled' },
    }).then(async (filledBuys: GridOrder[]) => {
      const orphans: GridOrder[] = [];
      for (const buy of filledBuys) {
        const hasSell = await this.prisma.gridOrder.findFirst({
          where: { gridId, side: 'sell', gridLevel: buy.gridLevel, status: { in: ['open', 'pending'] } },
        });
        if (!hasSell) orphans.push(buy);
      }
      return orphans;
    });

    if (filledBuysWithoutSell.length > 0) {
      this.logger.log(
        `Range update: ${filledBuysWithoutSell.length} filled buy(s) without counter sell — will place sells in new range`,
      );
    }

    // Cancel all open orders on exchange
    try {
      await this.exchange.cancelAllOrders(active.grid.instrument);
    } catch (err) {
      this.logger.warn(`Failed to cancel orders for grid ${gridId} during range update`, err);
    }

    // Mark open DB orders as cancelled
    await this.prisma.gridOrder.updateMany({
      where: { gridId, status: { in: ['pending', 'open'] } },
      data: { status: 'cancelled' },
    });

    // Persist new range config
    const updatedGrid = await this.prisma.grid.update({
      where: { id: gridId },
      data: { lowerPrice, upperPrice, gridCount },
    });

    // Recalculate levels with new range
    const newConfig: GridConfig = {
      instrument: updatedGrid.instrument,
      upperPrice,
      lowerPrice,
      gridCount,
      gridType: updatedGrid.gridType as 'arithmetic' | 'geometric',
      direction: updatedGrid.direction as 'long' | 'short' | 'neutral',
      leverage: updatedGrid.leverage,
      investmentAmount: updatedGrid.investmentAmount,
      stopLoss: updatedGrid.stopLoss ?? undefined,
      takeProfit: updatedGrid.takeProfit ?? undefined,
    };
    const levels = GridCalculator.calculateLevels(newConfig, minAmount, minNotional);

    // Get current price and place fresh window
    const ticker = await this.exchange.getTicker(updatedGrid.instrument);
    const currentPrice = ticker.markPrice;
    const { buyLevels, sellLevels } = GridCalculator.splitLevelsByPrice(levels, currentPrice);

    const direction = updatedGrid.direction;
    const slotsPerSide = Math.floor(MAX_OPEN_ORDERS / 2);
    const activeBuys = direction !== 'short' ? buyLevels.slice(-MAX_OPEN_ORDERS) : [];
    const activeSells = direction !== 'long' ? sellLevels.slice(0, MAX_OPEN_ORDERS) : [];
    const finalBuys  = direction === 'neutral' ? activeBuys.slice(-slotsPerSide)   : activeBuys;
    // Reserve slots for orphan sells so total stays within MAX_OPEN_ORDERS
    const orphanCount = Math.min(filledBuysWithoutSell.length, Math.floor(MAX_OPEN_ORDERS / 4));
    const cappedBuys  = finalBuys.slice(-(MAX_OPEN_ORDERS - orphanCount));
    const finalSells = direction === 'neutral' ? activeSells.slice(0, slotsPerSide) : activeSells;

    // Update in-memory state before placing orders
    const orderMap = new Map<string, GridOrder>();
    active.grid = updatedGrid;
    active.levels = levels;
    active.orderMap = orderMap;

    await this.placeInitialOrders(updatedGrid, cappedBuys, finalSells, orderMap);

    // Place sells for orphaned fills — use the nearest sell level above each fill price
    for (const orphanBuy of filledBuysWithoutSell) {
      const fillPrice = orphanBuy.filledPrice ?? orphanBuy.price;
      // Find the nearest sell level above the fill price within the new range
      const sellLevel = levels.find((l) => l.price > fillPrice && l.price <= upperPrice);
      if (!sellLevel) {
        this.logger.warn(`Range update: no sell level above ${fillPrice} in new range — skipping orphan sell`);
        continue;
      }
      // Don't double-place if this level already has an open sell
      const alreadyPlaced = [...orderMap.values()].some(
        (o) => o.side === 'sell' && o.gridLevel === sellLevel.index,
      );
      if (alreadyPlaced) continue;

      this.logger.log(`Range update: placing orphan sell @ ${sellLevel.price} (fill was @ ${fillPrice})`);
      await this.placeCounterOrder(
        { ...active, grid: updatedGrid, levels, orderMap },
        orphanBuy,
        'sell',
      );
    }

    const windowLow  = finalBuys[0]?.index  ?? (finalSells[0]?.index ?? 0);
    const windowHigh = finalSells.at(-1)?.index ?? (finalBuys.at(-1)?.index ?? levels.length - 1);
    active.windowLow  = windowLow;
    active.windowHigh = windowHigh;
    active.rebalancing = false;

    // Reset drift warning for new range
    this.driftWarnedGrids.delete(gridId);

    this.logger.log(
      `✅ Grid ${gridId} range updated → [${lowerPrice}–${upperPrice}] ${gridCount} grids, ` +
      `${orderMap.size} orders placed (window: levels ${windowLow}–${windowHigh})`,
    );

    return updatedGrid;
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
        // Index by side@price for reconciling 0x00 orders (counter/window orders get 0x00 until
        // GRVT assigns the real hash asynchronously — same issue as initial placement)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const openByKey = new Map<string, any>();
        for (const o of openOrders) {
          const key = `${o.side as string}@${parseFloat(o.price as string).toFixed(1)}`;
          openByKey.set(key, o);
        }

        // Find DB orders confirmed open (with real IDs) → check if they filled or were cancelled
        // 'pending' orders are still being reconciled — don't poll them yet
        const dbOpenOrders = await this.prisma.gridOrder.findMany({
          where: { gridId, status: 'open', grvtOrderId: { not: null } },
        });

        for (const dbOrder of dbOpenOrders) {
          const id = dbOrder.grvtOrderId;
          // Counter/window orders return 0x00 from GRVT until the hash is assigned async.
          // Reconcile by matching side@price in the already-fetched open orders list.
          if (!id || /^0x0+$/.test(id)) {
            const key = `${dbOrder.side}@${dbOrder.price.toFixed(1)}`;
            const match = openByKey.get(key);
            if (match?.id && !/^0x0+$/.test(match.id as string)) {
              await this.prisma.gridOrder.update({
                where: { id: dbOrder.id },
                data: { grvtOrderId: match.id as string, status: 'open' },
              });
              active.orderMap.set(match.id as string, { ...dbOrder, grvtOrderId: match.id as string });
              this.logger.debug(`Reconciled 0x00 → ${match.id as string} for ${dbOrder.side}@${dbOrder.price}`);
            } else {
              // Truly gone from exchange (filled or rejected before we could reconcile)
              await this.prisma.gridOrder.update({ where: { id: dbOrder.id }, data: { status: 'error' } });
              this.logger.debug(`Could not reconcile 0x00 for ${dbOrder.side}@${dbOrder.price} — marking error`);
            }
            continue;
          }
          if (!openOrderIds.has(id)) {
            if (this.processingFills.has(id)) continue; // already being processed
            this.processingFills.add(id);

            // Fetch actual order status: distinguish fill (closed) from cancel
            this.exchange.getOrder(id, active.grid.instrument)
              .then(async (order) => {
                if (order.status === 'closed') {
                  // GRVT FILLED → ccxt 'closed'
                  const filledPrice = (order.average ?? order.price ?? dbOrder.price) as number;
                  this.logger.debug(`Order ${id} filled @ ${filledPrice}`);
                  await this.onOrderFilled(id, filledPrice);
                } else if (order.status === 'canceled' || order.status === 'rejected' || order.status === 'expired') {
                  // Cancelled/rejected by exchange — mark in DB, no counter order
                  this.logger.debug(`Order ${id} status=${order.status} — marking cancelled, no counter`);
                  await this.prisma.gridOrder.update({
                    where: { id: dbOrder.id },
                    data: { status: 'cancelled' },
                  });
                } else {
                  // 'open' or 'pending' — still live, getOpenOrders may have been stale
                  this.logger.debug(`Order ${id} status=${order.status} — still live, ignoring`);
                }
              })
              .catch(async (err) => {
                // fetchOrder failed (order may be truly gone) — fall back to fill assumption
                this.logger.warn(`Could not fetch order ${id} — assuming filled`, err);
                await this.onOrderFilled(id, dbOrder.price);
              })
              .finally(() => this.processingFills.delete(id));
          }
        }
      } catch (err) {
        this.logger.warn(`Error polling fills for grid ${gridId}`, err);
      }
    }
  }

  /**
   * Poll the exchange position every 30s to keep unrealizedPnl current in DB.
   * This is the primary source for "Trend PnL" in the dashboard — it reflects the
   * mark-to-market value of open long/short exposure held by the grid.
   */
  @Interval(30000)
  async pollPositionPnl(): Promise<void> {
    for (const [gridId, active] of this.activeGrids) {
      try {
        const position = await this.exchange.getPosition(active.grid.instrument);
        // CCXT normalises unrealizedPnl across exchanges
        const unrealizedPnl: number = position ? ((position.unrealizedPnl as number) ?? 0) : 0;

        if (Math.abs(unrealizedPnl - (active.grid.unrealizedPnl ?? 0)) > 0.01) {
          await this.prisma.grid.update({ where: { id: gridId }, data: { unrealizedPnl } });
          active.grid = { ...active.grid, unrealizedPnl };
          await this.snapshotPnl(gridId);
          this.logger.debug(`Position PnL updated for grid ${gridId}: $${unrealizedPnl.toFixed(2)}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to poll position PnL for grid ${gridId}`, err);
      }
    }
  }

  /** Periodic PnL snapshot every 5 minutes so the chart always has data even between fills */
  @Interval(300000)
  async periodicPnlSnapshot(): Promise<void> {
    for (const [gridId] of this.activeGrids) {
      await this.snapshotPnl(gridId).catch(() => {});
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

    // Phase 1: Place all orders.
    // GRVT returns order_id = "0x00" while the order is PENDING — the real hash
    // is assigned asynchronously. We create DB records keyed by price+side first
    // and reconcile with real IDs in Phase 2.
    const pendingDbOrders: GridOrder[] = [];
    for (const level of allLevels) {
      try {
        await this.exchange.placeOrder({
          instrument: grid.instrument,
          side: level.side,
          type: 'limit',
          price: level.price,
          size: level.orderSize,
          timeInForce: 'GTC',
        });

        const dbOrder = await this.prisma.gridOrder.create({
          data: {
            gridId: grid.id,
            gridLevel: level.index,
            side: level.side,
            price: level.price,
            size: level.orderSize,
            status: 'pending', // upgraded to 'open' with real ID in Phase 2
            grvtOrderId: null,
          },
        });
        pendingDbOrders.push(dbOrder);

        // Small delay to respect rate limits
        await this.sleep(150);
      } catch (err) {
        this.logger.warn(`Failed to place ${level.side} @ ${level.price}`, err);
      }
    }

    // Phase 2: Reconcile real order IDs.
    // Wait for GRVT to move orders from PENDING → OPEN and assign real hashes.
    await this.sleep(3000);
    await this.reconcileOrderIds(grid, pendingDbOrders, orderMap);
  }

  /**
   * Fetch open orders from the exchange and match them to DB records by price+side.
   * Updates DB grvtOrderId and populates the orderMap with real IDs.
   */
  private async reconcileOrderIds(
    grid: Grid,
    pendingDbOrders: GridOrder[],
    orderMap: Map<string, GridOrder>,
  ): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const openOrders: any[] = await this.exchange.getOpenOrders(grid.instrument);
      this.logger.log(`Reconciling: ${pendingDbOrders.length} placed, ${openOrders.length} open on exchange`);

      // Index exchange orders by price+side for O(1) lookup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exchangeByKey = new Map<string, any>();
      for (const o of openOrders) {
        const key = `${o.side}@${parseFloat(o.price).toFixed(1)}`;
        exchangeByKey.set(key, o);
      }

      for (const dbOrder of pendingDbOrders) {
        const key = `${dbOrder.side}@${dbOrder.price.toFixed(1)}`;
        const match = exchangeByKey.get(key);

        if (match?.id && !/^0x0+$/.test(match.id)) {
          // Found real ID — update DB and orderMap
          await this.prisma.gridOrder.update({
            where: { id: dbOrder.id },
            data: { grvtOrderId: match.id, status: 'open' },
          });
          orderMap.set(match.id, { ...dbOrder, grvtOrderId: match.id, status: 'open' });
          exchangeByKey.delete(key); // prevent double-matching
        } else {
          // Not found in open orders — could be filled during placement or truly cancelled.
          // Fetch individual order history to distinguish.
          // We don't have the real orderId yet, so search recent closed orders by price+side.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const recentOrders: any[] = await this.exchange.getRecentOrders(grid.instrument);
          const recentMatch = recentOrders.find((o) => {
            const key = `${o.side}@${parseFloat(o.price).toFixed(1)}`;
            return key === `${dbOrder.side}@${dbOrder.price.toFixed(1)}` && o.status === 'closed';
          });

          if (recentMatch?.id) {
            // Order filled during the placement window — treat as fill
            const filledPrice = parseFloat(recentMatch.average ?? recentMatch.price ?? dbOrder.price);
            this.logger.log(`Order ${dbOrder.side} @ ${dbOrder.price} filled during placement @ ${filledPrice} — triggering counter`);
            await this.prisma.gridOrder.update({
              where: { id: dbOrder.id },
              data: { grvtOrderId: recentMatch.id, status: 'filled', filledPrice, filledAt: new Date() },
            });
            // Temporarily add to orderMap so onOrderFilled can find it
            const filledDbOrder = { ...dbOrder, grvtOrderId: recentMatch.id, status: 'filled' };
            await this.onOrderFilled(recentMatch.id, filledPrice);
          } else {
            // Truly cancelled (order limit, rejection, etc)
            await this.prisma.gridOrder.update({
              where: { id: dbOrder.id },
              data: { status: 'cancelled' },
            });
            this.logger.debug(`Order ${dbOrder.side} @ ${dbOrder.price} cancelled by exchange`);
          }
        }
      }

      this.logger.log(`Reconciled: ${orderMap.size} orders active with real IDs`);
    } catch (err) {
      this.logger.error('Failed to reconcile order IDs', err);
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

    // Guard: don't place if price is >12% away from current market price
    // (GRVT price protection band is ~±10%, leave 2% margin)
    const marketPrice = active.grid.currentPrice ?? 0;
    if (marketPrice > 0) {
      const deviation = Math.abs(counterLevel.price - marketPrice) / marketPrice;
      if (deviation > 0.12) {
        this.logger.warn(
          `Skipping counter ${side} @ ${counterLevel.price} — ${(deviation * 100).toFixed(1)}% from market (${marketPrice}), outside protection band`,
        );
        return;
      }
    }

    // Don't duplicate: if there's already an open order at this level/side, skip
    const existing = await this.prisma.gridOrder.findFirst({
      where: { gridId: active.grid.id, gridLevel: counterLevel.index, side, status: 'open' },
    });
    if (existing) {
      this.logger.debug(`Counter ${side} @ ${counterLevel.price} already open (${existing.grvtOrderId}) — skipping`);
      return;
    }

    // Respect GRVT open order cap — don't place if we'd exceed the limit
    const openCount = await this.prisma.gridOrder.count({
      where: { gridId: active.grid.id, status: 'open' },
    });
    if (openCount >= MAX_OPEN_ORDERS) {
      this.logger.warn(
        `Open order cap reached (${openCount}/${MAX_OPEN_ORDERS}) — skipping counter ${side} @ ${counterLevel.price}`,
      );
      return;
    }

    try {
      const response = await this.exchange.placeOrder({
        instrument: active.grid.instrument,
        side,
        type: 'limit',
        price: counterLevel.price,
        size: counterLevel.orderSize,
        timeInForce: 'GTC',
      });

      const dbOrder = await this.prisma.gridOrder.upsert({
        where: { grvtOrderId: response.orderId },
        create: {
          gridId: active.grid.id,
          gridLevel: counterLevel.index,
          side,
          price: counterLevel.price,
          size: counterLevel.orderSize,
          status: 'open',
          grvtOrderId: response.orderId,
        },
        update: {
          gridId: active.grid.id,
          gridLevel: counterLevel.index,
          side,
          price: counterLevel.price,
          size: counterLevel.orderSize,
          status: 'open',
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
        fundingPnl: grid.fundingPnl,
        totalPnl: grid.realizedPnl + grid.unrealizedPnl + grid.fundingPnl,
        currentPrice: grid.currentPrice ?? 0,
      },
    });
  }

  /** Computed stats for a grid — Pionex-style summary */
  async getStats(gridId: string) {
    const grid = await this.prisma.grid.findUniqueOrThrow({ where: { id: gridId } });

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rounds24h = await this.prisma.gridTrade.count({
      where: { gridId, timestamp: { gte: since24h } },
    });

    const daysActive = (Date.now() - grid.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const gridPnl = grid.realizedPnl;
    const trendPnl = grid.unrealizedPnl;
    const fundingPnl = grid.fundingPnl;
    const totalPnl = gridPnl + trendPnl + fundingPnl;
    const totalPnlPct = grid.investmentAmount > 0 ? (totalPnl / grid.investmentAmount) * 100 : 0;

    // APR = (pnl / investment) / daysActive * 365 * 100
    const aprGrid = daysActive > 0 ? (gridPnl / grid.investmentAmount / daysActive) * 365 * 100 : 0;
    const aprTotal = daysActive > 0 ? (totalPnl / grid.investmentAmount / daysActive) * 365 * 100 : 0;

    // Profit per grid interval % = gridSpacing / midPrice
    const midPrice = (grid.upperPrice + grid.lowerPrice) / 2;
    const gridSpacing = (grid.upperPrice - grid.lowerPrice) / grid.gridCount;
    const profitPerGridPct = midPrice > 0 ? (gridSpacing / midPrice) * 100 : 0;

    return {
      gridId,
      totalPnl,
      totalPnlPct,
      gridPnl,
      trendPnl,
      fundingPnl,
      aprGrid: Math.round(aprGrid * 100) / 100,
      aprTotal: Math.round(aprTotal * 100) / 100,
      rounds24h,
      roundsTotal: grid.tradeCount,
      profitPerGridPct: Math.round(profitPerGridPct * 100) / 100,
      daysActive: Math.round(daysActive * 10) / 10,
    };
  }

  /** Get all orders for a grid (Pionex "Colocadas" tab) */
  async getOrders(gridId: string, status?: string) {
    return this.prisma.gridOrder.findMany({
      where: { gridId, ...(status ? { status } : {}) },
      orderBy: { price: 'asc' },
    });
  }

  /** Get completed trades for a grid (Pionex "Transacciones" tab) */
  async getTrades(gridId: string) {
    return this.prisma.gridTrade.findMany({
      where: { gridId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });
  }

  /** Get funding payment history (Pionex "Historial de financiación") */
  async getFundingHistory(gridId: string) {
    return this.prisma.fundingPayment.findMany({
      where: { gridId },
      orderBy: { timestamp: 'desc' },
    });
  }

  /** Get PnL snapshots for chart */
  async getPnlSnapshots(gridId: string) {
    return this.prisma.pnlSnapshot.findMany({
      where: { gridId },
      orderBy: { timestamp: 'asc' },
      take: 500,
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

      // Sliding window: shift active orders as price drifts across levels.
      // Use a per-grid lock so concurrent price ticks don't stack up rebalances.
      if (!active.rebalancing) {
        active.rebalancing = true;
        this.rebalanceWindow(gridId, active, price)
          .catch((err) => this.logger.error(`Rebalance error for grid ${gridId}`, err))
          .finally(() => { active.rebalancing = false; });
      }

      // Range drift detection: warn when price has drifted far outside the grid's defined range.
      this.checkRangeDrift(gridId, active, price);

      // Stop loss check
      const stopLoss = active.grid.stopLoss;
      if (stopLoss && price <= stopLoss) {
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

  /**
   * Warns when the current price has drifted more than DRIFT_THRESHOLD outside the grid's
   * configured lowerPrice–upperPrice range. At that point all orders are idle (no fills
   * possible) until price returns. The warning fires at most once per drift event (tracked
   * via the driftWarned flag on the active grid to avoid log spam on every tick).
   */
  private readonly driftWarnedGrids = new Set<string>();

  private checkRangeDrift(gridId: string, active: ActiveGrid, price: number): void {
    const DRIFT_THRESHOLD = 0.08; // 8% outside the declared range
    const { lowerPrice, upperPrice } = active.grid;
    const aboveRange = price > upperPrice * (1 + DRIFT_THRESHOLD);
    const belowRange = price < lowerPrice * (1 - DRIFT_THRESHOLD);

    if (aboveRange || belowRange) {
      if (!this.driftWarnedGrids.has(gridId)) {
        this.driftWarnedGrids.add(gridId);
        const dir = aboveRange ? 'above' : 'below';
        const bound = aboveRange ? upperPrice : lowerPrice;
        this.logger.warn(
          `⚠️  RANGE DRIFT [grid ${gridId}]: price ${price.toFixed(1)} is >8% ${dir} grid ${dir === 'above' ? 'ceiling' : 'floor'} ${bound}. ` +
          `All orders are idle. Consider stopping and recreating with a wider range centered on current price.`,
        );
      }
    } else {
      // Price returned inside range — reset so the warning fires again if it drifts out again
      this.driftWarnedGrids.delete(gridId);
    }
  }

  /**
   * Sliding window rebalancer.
   *
   * Keeps the active order window centered around the current price.
   * As price drifts up:  cancel the lowest buy (too far from market) → open a new sell one step higher.
   * As price drifts down: cancel the highest sell (too far from market) → open a new buy one step lower.
   *
   * Only runs when the ideal window boundaries differ from the current ones,
   * so it's a no-op on most price ticks.
   */
  private async rebalanceWindow(gridId: string, active: ActiveGrid, currentPrice: number): Promise<void> {
    const direction = active.grid.direction ?? 'long';
    const slotsPerSide = Math.floor(MAX_OPEN_ORDERS / 2);

    // Find the first level index >= currentPrice (buy/sell boundary)
    let midIndex = active.levels.findIndex((l) => l.price >= currentPrice);

    // Price is above ALL grid levels (midIndex === -1).
    // For LONG: treat midIndex as levels.length so idealLow/High shift to keep
    //           the top MAX_OPEN_ORDERS buy levels active (closest to current price).
    //           This prevents the window from freezing when ETH pumps above upperPrice.
    // For SHORT/NEUTRAL: price left the grid range upward — nothing useful to do.
    if (midIndex < 0) {
      if (direction === 'long') {
        midIndex = active.levels.length;
      } else {
        return;
      }
    }

    // Ideal window boundaries depend on direction:
    //  long:    only buy orders → track low side, no sell sliding
    //  short:   only sell orders → track high side, no buy sliding
    //  neutral: both sides centered around price
    let idealLow: number;
    let idealHigh: number;

    if (direction === 'long') {
      // Keep up to MAX_OPEN_ORDERS buys below the price; no sliding sells
      idealLow  = Math.max(0, midIndex - MAX_OPEN_ORDERS);
      idealHigh = midIndex - 1; // sells not managed by window (counter-orders only)
    } else if (direction === 'short') {
      // Keep up to MAX_OPEN_ORDERS sells above the price; no sliding buys
      idealLow  = midIndex;     // buys not managed by window
      idealHigh = Math.min(active.levels.length - 1, midIndex + MAX_OPEN_ORDERS - 1);
    } else {
      // neutral: symmetric window
      idealLow  = Math.max(0, midIndex - slotsPerSide);
      idealHigh = Math.min(active.levels.length - 1, midIndex + slotsPerSide - 1);
    }

    if (idealLow === active.windowLow && idealHigh === active.windowHigh) return;

    this.logger.debug(
      `Sliding window [${direction}] shift: [${active.windowLow}–${active.windowHigh}] → [${idealLow}–${idealHigh}] at price ${currentPrice}`,
    );

    // Shift UP: price moved up → drop stale low buys, add new high sells (neutral only)
    while (active.windowLow < idealLow) {
      const cancelIndex = active.windowLow;
      const cancelLevel = active.levels[cancelIndex];

      const staleOrder = await this.prisma.gridOrder.findFirst({
        where: { gridId, gridLevel: cancelIndex, side: 'buy', status: 'open' },
      });
      if (staleOrder?.grvtOrderId) {
        await this.exchange.cancelOrder(staleOrder.grvtOrderId, active.grid.instrument).catch(() => {});
        await this.prisma.gridOrder.update({ where: { id: staleOrder.id }, data: { status: 'cancelled' } });
        active.orderMap.delete(staleOrder.grvtOrderId);
        this.logger.debug(`Window ↑: cancelled stale buy @ ${cancelLevel.price} [level ${cancelIndex}]`);
      }
      active.windowLow++;

      // For neutral only: add a sell at the top
      if (direction === 'neutral') {
        const newHighIndex = active.windowHigh + 1;
        if (newHighIndex < active.levels.length) {
          await this.placeWindowOrder(active, newHighIndex, 'sell');
          active.windowHigh = newHighIndex;
        }
      }
    }

    // Shift DOWN: price moved down → drop stale high sells, add new low buys (neutral only)
    while (active.windowHigh > idealHigh) {
      const cancelIndex = active.windowHigh;
      const cancelLevel = active.levels[cancelIndex];

      const staleOrder = await this.prisma.gridOrder.findFirst({
        where: { gridId, gridLevel: cancelIndex, side: 'sell', status: 'open' },
      });
      if (staleOrder?.grvtOrderId) {
        await this.exchange.cancelOrder(staleOrder.grvtOrderId, active.grid.instrument).catch(() => {});
        await this.prisma.gridOrder.update({ where: { id: staleOrder.id }, data: { status: 'cancelled' } });
        active.orderMap.delete(staleOrder.grvtOrderId);
        this.logger.debug(`Window ↓: cancelled stale sell @ ${cancelLevel.price} [level ${cancelIndex}]`);
      }
      active.windowHigh--;

      // For neutral only: add a buy at the bottom
      if (direction === 'neutral') {
        const newLowIndex = active.windowLow - 1;
        if (newLowIndex >= 0) {
          await this.placeWindowOrder(active, newLowIndex, 'buy');
          active.windowLow = newLowIndex;
        }
      }
    }

    // For long: when price moves down, ensure we have buy coverage up to MAX_OPEN_ORDERS
    if (direction === 'long') {
      while (active.windowLow > idealLow) {
        const newLowIndex = active.windowLow - 1;
        if (newLowIndex >= 0) {
          await this.placeWindowOrder(active, newLowIndex, 'buy');
          active.windowLow = newLowIndex;
        } else break;
      }
    }

    // For short: when price moves up, ensure we have sell coverage up to MAX_OPEN_ORDERS
    if (direction === 'short') {
      while (active.windowHigh < idealHigh) {
        const newHighIndex = active.windowHigh + 1;
        if (newHighIndex < active.levels.length) {
          await this.placeWindowOrder(active, newHighIndex, 'sell');
          active.windowHigh = newHighIndex;
        } else break;
      }
    }
  }

  /** Place a single order as part of a window shift. Skips if already open at that level/side. */
  private async placeWindowOrder(active: ActiveGrid, levelIndex: number, side: 'buy' | 'sell'): Promise<void> {
    const level = active.levels[levelIndex];
    if (!level) return;

    // Skip if already open (e.g. a counter-order landed here after a fill)
    const existing = await this.prisma.gridOrder.findFirst({
      where: { gridId: active.grid.id, gridLevel: levelIndex, side, status: 'open' },
    });
    if (existing) return;

    // Guard: don't place outside GRVT price protection band (~±10%)
    const marketPrice = active.grid.currentPrice ?? 0;
    if (marketPrice > 0 && Math.abs(level.price - marketPrice) / marketPrice > 0.12) return;

    try {
      const response = await this.exchange.placeOrder({
        instrument: active.grid.instrument,
        side,
        type: 'limit',
        price: level.price,
        size: level.orderSize,
        timeInForce: 'GTC',
      });

      const dbOrder = await this.prisma.gridOrder.upsert({
        where: { grvtOrderId: response.orderId },
        create: {
          gridId: active.grid.id,
          gridLevel: level.index,
          side,
          price: level.price,
          size: level.orderSize,
          status: 'open',
          grvtOrderId: response.orderId,
        },
        update: {
          gridId: active.grid.id,
          gridLevel: level.index,
          side,
          price: level.price,
          size: level.orderSize,
          status: 'open',
        },
      });

      active.orderMap.set(response.orderId, dbOrder);
      this.logger.debug(`Window: placed ${side} @ ${level.price} [level ${levelIndex}]`);
    } catch (err) {
      this.logger.error(`Window order failed: ${side} @ ${level.price}`, err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
