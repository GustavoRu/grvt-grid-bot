import { GridConfig, GridLevel, GRID_CONSTRAINTS } from '@grvt-grid-bot/shared';

export class GridCalculator {
  /**
   * Calculate all grid levels for a given config.
   * Returns an array of levels from bottom (index 0) to top (index gridCount).
   * The grid has gridCount+1 price points but gridCount intervals.
   *
   * @param minAmount   - exchange min order size in base asset (e.g. 0.001 ETH)
   * @param minNotional - exchange min order value in quote (e.g. $20 on GRVT)
   */
  static calculateLevels(config: GridConfig, minAmount = 0, minNotional = 0): GridLevel[] {
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
      // Clamp to largest of: calculated size, min amount, min notional / price
      // Use ceiling for notional-derived min to ensure price × size >= minNotional
      const minByNotional = minNotional > 0 ? minNotional / price : 0;
      const effectiveMin = Math.max(minAmount, minByNotional);
      const orderSize = effectiveMin > 0
        ? Math.max(this.roundSize(rawSize), this.roundSizeUp(effectiveMin))
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

  /** Ceiling to 4 decimals — guarantees notional >= minimum after rounding */
  private static roundSizeUp(size: number): number {
    return Math.ceil(size * 10000) / 10000;
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
