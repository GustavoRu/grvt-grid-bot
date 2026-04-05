import { GridConfig, GridLevel, GRID_CONSTRAINTS } from '@grvt-grid-bot/shared';

export class GridCalculator {
  /**
   * Calculate all grid levels for a given config.
   * Returns an array of levels from bottom (index 0) to top (index gridCount).
   * The grid has gridCount+1 price points but gridCount intervals.
   *
   * @param minOrderSize - exchange minimum order size (e.g. 0.001 for BTC on GRVT)
   */
  static calculateLevels(config: GridConfig, minOrderSize = 0): GridLevel[] {
    const { upperPrice, lowerPrice, gridCount, gridType, investmentAmount, leverage } = config;

    if (upperPrice <= lowerPrice) throw new Error('upperPrice must be greater than lowerPrice');
    if (gridCount < GRID_CONSTRAINTS.minGridCount) throw new Error(`gridCount min is ${GRID_CONSTRAINTS.minGridCount}`);
    if (gridCount > GRID_CONSTRAINTS.maxGridCount) throw new Error(`gridCount max is ${GRID_CONSTRAINTS.maxGridCount}`);

    const prices = gridType === 'arithmetic'
      ? this.arithmeticPrices(lowerPrice, upperPrice, gridCount)
      : this.geometricPrices(lowerPrice, upperPrice, gridCount);

    // Investment per grid interval split evenly across all levels
    const capitalPerGrid = (investmentAmount * leverage) / gridCount;

    return prices.map((price, index) => {
      const rawSize = capitalPerGrid / price;
      // Clamp to exchange minimum — if investment is small, orders are rounded up to min size
      const orderSize = minOrderSize > 0
        ? Math.max(this.roundSize(rawSize), minOrderSize)
        : this.roundSize(rawSize);
      return { index, price: this.roundPrice(price), orderSize };
    });
  }

  /**
   * Calculate the profit per grid interval (arithmetic grid).
   * Each filled buy→sell cycle earns: (sell_price - buy_price) * size - fees
   */
  static calculateGridProfit(config: GridConfig, feeRate = 0.0005): number {
    const levels = this.calculateLevels(config);
    if (levels.length < 2) return 0;

    const interval = levels[1].price - levels[0].price;
    const midPrice = (config.upperPrice + config.lowerPrice) / 2;
    const orderSize = levels[0].orderSize;

    const grossProfit = interval * orderSize;
    const fees = midPrice * orderSize * feeRate * 2; // entry + exit
    return grossProfit - fees;
  }

  /** Price levels spaced evenly by dollar amount */
  private static arithmeticPrices(lower: number, upper: number, count: number): number[] {
    const step = (upper - lower) / count;
    return Array.from({ length: count + 1 }, (_, i) => lower + step * i);
  }

  /** Price levels spaced evenly by percentage */
  private static geometricPrices(lower: number, upper: number, count: number): number[] {
    const ratio = Math.pow(upper / lower, 1 / count);
    return Array.from({ length: count + 1 }, (_, i) => lower * Math.pow(ratio, i));
  }

  private static roundPrice(price: number): number {
    return Math.round(price * 10) / 10; // 1 decimal for BTC-range prices
  }

  private static roundSize(size: number): number {
    return Math.round(size * 10000) / 10000; // 4 decimals
  }

  /**
   * Given current market price, split levels into:
   * - buyLevels: all levels below current price (place BUY orders)
   * - sellLevels: all levels above current price (place SELL orders)
   */
  static splitLevelsByPrice(
    levels: GridLevel[],
    currentPrice: number,
  ): { buyLevels: GridLevel[]; sellLevels: GridLevel[] } {
    return {
      buyLevels: levels.filter((l) => l.price < currentPrice),
      sellLevels: levels.filter((l) => l.price > currentPrice),
    };
  }
}
