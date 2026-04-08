# GRVT Grid Bot — Agent Instructions

This is a NestJS + Next.js monorepo (pnpm workspaces + Turborepo) that runs a perpetual futures grid bot on the GRVT exchange.

```
apps/bot/        → NestJS grid engine (port 4001)
apps/dashboard/  → Next.js dashboard (port 4000)
packages/shared/ → TypeScript types shared by both apps
```

---

## GRVT / CCXT Exchange Quirks

These are hard-won discoveries. Never change these without strong reason.

### 1. `expirationSeconds` — THE most critical setting
CCXT's `grvt` exchange defaults `expirationSeconds` to **30 seconds**. This means every order auto-expires 30s after placement unless overridden.

**Fix in `grvt-exchange.service.ts`:**
```typescript
expirationSeconds: 2592000  // 30 days
```
Source: CCXT grvt source line:
```
const expiration = this.milliseconds() * 1000000 + 1000000 * this.safeInteger(this.options, 'expirationSeconds', 30) * 1000;
```

### 2. `0x00` order ID — asynchronous ID assignment
GRVT returns `order_id = "0x00"` immediately after placement while the order is in PENDING state. The real hash is assigned asynchronously. Never store `0x00` as a real order ID.

**Fix:** Two-phase placement:
- Phase 1: Place order on exchange → store DB record with `status='pending', grvtOrderId=null`
- Phase 2: After `sleep(3000)`, call `reconcileOrderIds()` which fetches open orders and matches by `${side}@${price.toFixed(1)}` key

### 3. Open order limit — tier-dependent, Tier 1 = 20 orders max
GRVT limits open orders per instrument per sub-account by account tier. Placing beyond the limit causes all pending orders to be cancelled in bulk.

| Tier | Open orders limit |
|------|-------------------|
| Tier 1 (default, testnet & mainnet) | **20** |
| Tier 3 | ~40 |
| Tier 9 (VIP max) | **100** |

**Fix:** `MAX_OPEN_ORDERS = 20` constant in `grid-engine.service.ts`. Raise this constant if the account is upgraded to a higher tier.

### 4. `postOnly` breaks `timeInForce`
Do NOT pass `postOnly: true` to CCXT for GRVT orders. When `postOnly=true`, CCXT skips setting `time_in_force` entirely, causing GRVT to reject with error code 2030.

**Fix:** Never pass `postOnly`. Use `timeInForce: 'GTC'` only.

### 5. Price protection band ±10%
GRVT rejects orders more than ~10% away from the mark price. Counter orders and window rebalance orders guard against this:
```typescript
if (deviation > 0.12) { /* skip — outside protection band */ }
```

### 6. `initializeClient()` required for order signing
With API key auth, CCXT's `signIn()` skips `initializeClient()` — the step that authorizes GRVT's order builder via EIP-712. Without it, all orders fail with code 7504 "Builder is not authorized".

**Fix:** Call `initializeClient()` explicitly after `loadMarkets()` in `onModuleInit()`.

### 7. Min notional — always use `Math.ceil`, always add 5% buffer
GRVT minimum notional is $20. Using `Math.round` for order sizes can push `price × size` below $20. Always use `Math.ceil` (via `roundSizeUp`). Also apply a 5% safety buffer: `minNotional = Math.ceil(rawMinNotional * 1.05)` → effective floor is $21.

### 8. Instrument format
CCXT uses slash format (`BTC/USDT:USDT`), GRVT uses underscore format (`BTC_USDT_Perp`).
Conversion: `BTC_USDT_Perp` → `BTC/USDT:USDT` is handled by `toSymbol()` in `grvt-exchange.service.ts`.

### 9. `fetchOrder` status mapping
- GRVT `FILLED` → CCXT `'closed'`
- GRVT `CANCELLED` → CCXT `'canceled'`
- GRVT `REJECTED` → CCXT `'rejected'`

Never assume a missing order is a fill — always call `fetchOrder` to distinguish fill from cancel.

---

## Grid Direction Semantics (Pionex-style)

This mirrors how Pionex "Futures Grid" works:

| Direction | Initial orders | Counter orders |
|-----------|---------------|----------------|
| `long`    | BUY only (below price) | After buy fills → place SELL one level up |
| `short`   | SELL only (above price) | After sell fills → place BUY one level down |
| `neutral` | BOTH sides (10 buys + 10 sells) | Standard both-sides counter orders |

**Why:** A `long` grid with initial SELL orders above price would open short exposure when those sells fill before any paired buys exist. `long` mode = no net short exposure at startup.

The sliding window (`rebalanceWindow`) is direction-aware:
- `long`: only manages buy-side window; sells come from counter orders only
- `short`: only manages sell-side window; buys come from counter orders only
- `neutral`: symmetric expansion/contraction on both sides

---

## Order Lifecycle

```
exchange.placeOrder()
  ↓
DB: status='pending', grvtOrderId=null
  ↓ sleep(3000)
reconcileOrderIds() → fetchOpenOrders → match by side@price
  ↓
DB: status='open', grvtOrderId='0xabc...'   ← real hash
  ↓
pollOrderFills() every 10s
  ↓ order missing from fetchOpenOrders?
fetchOrder(id) → distinguish 'closed' (fill) vs 'canceled'/'rejected'
  ↓ fill
onOrderFilled() → placeCounterOrder()
```

**`processingFills` Set:** Prevents double-processing when the 10s poll fires concurrently. An order ID is added before async work and removed in `.finally()`.

**Reconciler fallback:** If an order isn't in `fetchOpenOrders` after 3s, it may have filled during placement. The reconciler calls `getRecentOrders()` (last 50 orders) and looks for a `closed` match at the same `side@price`.

---

## Grid Recovery on Restart

`recoverActiveGrids()` runs on startup (after `pruneStaleOrders()`):
1. Find all grids with `status='active'` in DB
2. Recalculate levels from stored config (deterministic)
3. `fetchOpenOrders` from exchange → rebuild `orderMap` by matching `side@price`
4. DB orders not found on exchange → mark `cancelled`
5. Exchange orders not in DB → cancel them (unknown orders)
6. Re-subscribe to market data, run `rebalanceWindow()` to fill gaps

This handles Mac sleep, crashes, and intentional restarts.

---

## Sliding Window

GRVT Tier 1 = 20 max open orders. The window keeps exactly `MAX_OPEN_ORDERS` orders active nearest to the current price. As price drifts:

- **Price up:** cancel lowest buy (stale, far from market) → place new sell one step higher (neutral) or just drop lowest buy (long)
- **Price down:** cancel highest sell (stale, far from market) → place new buy one step lower (neutral) or just drop highest sell (short)

`rebalancing: boolean` flag on `ActiveGrid` prevents concurrent rebalances from stacking up on rapid price ticks.

---

## Key Files

| File | Role |
|------|------|
| `apps/bot/src/grid-engine/grid-engine.service.ts` | Core bot logic: start/stop grids, order lifecycle, sliding window, recovery |
| `apps/bot/src/grid-engine/grvt-exchange.service.ts` | CCXT wrapper: order placement, exchange quirks |
| `apps/bot/src/grid-engine/grid-calculator.ts` | Price level math, order size calculation |
| `apps/bot/src/market-data/market-data.service.ts` | WebSocket price feed |
| `apps/bot/.env` | Credentials and runtime config |
| `packages/shared/src/index.ts` | Shared types (GridConfig, GridLevel, etc.) |

---

## Ports

- Bot API: **4001** (`BOT_PORT=4001` in `apps/bot/.env`)
- Dashboard: **4000** (`next dev -p 4000` in `apps/dashboard/package.json`)

---

## Common Debugging Checklist

1. **Orders expiring 30s after placement** → check `expirationSeconds` in `grvt-exchange.service.ts`
2. **Only 1 order in DB after placing 20** → `0x00` upsert collision; check two-phase placement flow
3. **All orders cancelled after 20th** → hit GRVT 20-order limit; check `MAX_OPEN_ORDERS` guard
4. **Short position opened in LONG grid** → initial sells placed; check `direction !== 'long'` guard in `startGrid()`
5. **Bot loses state after Mac sleep / restart** → `recoverActiveGrids()` should handle this; check startup logs
6. **Order code 2030** → `postOnly` was passed; ensure only `timeInForce: 'GTC'` is set
7. **Order code 7504 "Builder not authorized"** → `initializeClient()` not called; check `onModuleInit()`
8. **Min-notional errors** → verify `roundSizeUp` (not `round`) and 5% buffer in `getMarketLimits()`
