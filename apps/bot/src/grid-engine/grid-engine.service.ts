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
    // Listen to price updates to trigger stop-loss checks
    this.marketData.on('price', (update) => this.onPriceUpdate(update));
    // Clean up orphaned orders from failed/error grids on startup
    this.pruneStaleOrders().catch(() => {});
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

      // GRVT limits open orders per instrument per sub-account (Tier 1 = 20).
      // Only activate the N/2 buy levels closest to current price (highest prices)
      // and N/2 sell levels closest to current price (lowest prices).
      const slotsPerSide = Math.floor(MAX_OPEN_ORDERS / 2);
      const activeBuys = buyLevels.slice(-slotsPerSide);  // nearest buys = highest prices
      const activeSells = sellLevels.slice(0, slotsPerSide); // nearest sells = lowest prices
      this.logger.log(
        `Order window: ${activeBuys.length} buys (${activeBuys[0]?.price}–${activeBuys.at(-1)?.price}) + ` +
        `${activeSells.length} sells (${activeSells[0]?.price}–${activeSells.at(-1)?.price}) [limit: ${MAX_OPEN_ORDERS}]`,
      );

      // Place initial orders
      const orderMap = new Map<string, GridOrder>();
      await this.placeInitialOrders(grid, activeBuys, activeSells, orderMap);

      // Activate grid — set entryPrice = currentPrice at start (Pionex "Precio inicial")
      const activeGrid = await this.prisma.grid.update({
        where: { id: grid.id },
        data: { status: 'active', currentPrice, entryPrice: currentPrice },
      });

      // Track the active window boundaries so the sliding window knows what to shift
      const windowLow = activeBuys[0]?.index ?? 0;
      const windowHigh = activeSells.at(-1)?.index ?? levels.length - 1;

      this.activeGrids.set(grid.id, { grid: activeGrid, levels, orderMap, windowLow, windowHigh, rebalancing: false });
      this.logger.log(`✅ Grid ${grid.id} active with ${orderMap.size} orders (window: levels ${windowLow}–${windowHigh})`);

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

        // Find DB orders confirmed open (with real IDs) → check if they filled or were cancelled
        // 'pending' orders are still being reconciled — don't poll them yet
        const dbOpenOrders = await this.prisma.gridOrder.findMany({
          where: { gridId, status: 'open', grvtOrderId: { not: null } },
        });

        for (const dbOrder of dbOpenOrders) {
          // Skip placeholder IDs returned by CCXT when an order was rejected
          // (e.g. "0x00" or "0x0000000000000000000000000000000000000000000000000000000000000000")
          const id = dbOrder.grvtOrderId;
          if (!id || /^0x0+$/.test(id)) {
            this.logger.debug(`Skipping invalid order ID ${id} — marking as error`);
            await this.prisma.gridOrder.update({
              where: { id: dbOrder.id },
              data: { status: 'error' },
            });
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
    const slotsPerSide = Math.floor(MAX_OPEN_ORDERS / 2);

    // Find the first level index >= currentPrice (the boundary between buys and sells)
    const midIndex = active.levels.findIndex((l) => l.price >= currentPrice);
    if (midIndex < 0) return; // price above all levels — nothing to do

    // Ideal window: slotsPerSide buys below mid, slotsPerSide sells above mid
    const idealLow  = Math.max(0, midIndex - slotsPerSide);
    const idealHigh = Math.min(active.levels.length - 1, midIndex + slotsPerSide - 1);

    // No shift needed
    if (idealLow === active.windowLow && idealHigh === active.windowHigh) return;

    this.logger.debug(
      `Sliding window shift: [${active.windowLow}–${active.windowHigh}] → [${idealLow}–${idealHigh}] at price ${currentPrice}`,
    );

    // Shift UP: price moved up → drop stale low buys, add new high sells
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

      // Place new sell at the top of the window
      const newHighIndex = active.windowHigh + 1;
      if (newHighIndex < active.levels.length) {
        await this.placeWindowOrder(active, newHighIndex, 'sell');
        active.windowHigh = newHighIndex;
      }
    }

    // Shift DOWN: price moved down → drop stale high sells, add new low buys
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

      // Place new buy at the bottom of the window
      const newLowIndex = active.windowLow - 1;
      if (newLowIndex >= 0) {
        await this.placeWindowOrder(active, newLowIndex, 'buy');
        active.windowLow = newLowIndex;
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
