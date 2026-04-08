---
name: grid-validate
description: Validate a grid config before creating it. Use when planning a new grid, checking if parameters are profitable, or diagnosing a min-notional error.
disable-model-invocation: false
allowed-tools: Read Grep Bash
---

Validate the following grid configuration for profitability and exchange compatibility.
Configuration to validate: $ARGUMENTS

## Checks to run

### 1. Min-notional check (GRVT enforces $20 minimum, we use $21 with 5% buffer)

```
capital_per_grid = (investmentAmount × leverage) / gridCount
```

- If `capital_per_grid < $21`: FAIL — calculate minimum investment needed:
  ```
  min_investment = ceil((21 × gridCount) / leverage)
  ```

### 2. Spacing profitability check (fee-aware)

For GRVT testnet fees are ~0.05% maker. Each buy→sell cycle costs 2 × fee.

```
range_pct = (upperPrice - lowerPrice) / lowerPrice × 100
spacing_pct = range_pct / gridCount
profit_per_grid_pct = spacing_pct - (2 × 0.05%)
```

- If `spacing_pct < 0.2%`: WARN — barely profitable, consider fewer grids
- If `spacing_pct < 0.10%`: FAIL — fee erosion guaranteed

### 3. Leverage safety check

```
liquidation_distance_pct ≈ 1 / leverage × 100
```

- Ensure `lowerPrice` is at least `(1/leverage × 1.5)` below entry price as safety buffer
- If `leverage > 5` and `lowerPrice > currentPrice × (1 - 1/leverage × 0.8)`: WARN — stop loss too tight for leverage

### 4. GRVT 20-order limit

```
max_active_orders = 20
```

- Long grid: up to 20 buy orders active at startup
- If `gridCount > 20`: WARN — sliding window will activate, not all grids are active simultaneously

### 5. Order size check

```
order_size = capital_per_grid / price  (rounded UP to 4 decimals)
```

Check that `order_size × price ≥ $21` at both `upperPrice` and `lowerPrice`.

## Output format

Print a table:

| Check | Value | Status |
|-------|-------|--------|
| Capital/grid | $XX.XX | ✅ / ❌ |
| Spacing | X.XX% | ✅ / ⚠️ / ❌ |
| Profit/grid | X.XX% | ✅ / ❌ |
| Leverage safety | XX% buffer | ✅ / ⚠️ |
| Order limit | XX / 20 | ✅ / ⚠️ |
| Min order size | X.XXXX @ $XXXX | ✅ / ❌ |

Then print a summary: READY TO CREATE / NEEDS ADJUSTMENT and the specific changes required.

## Example usage

/grid-validate instrument=ETH_USDT_Perp upperPrice=2200 lowerPrice=1900 gridCount=20 leverage=3 investmentAmount=300 direction=long
