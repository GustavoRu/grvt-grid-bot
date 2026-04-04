# GRVT Grid Trading Bot — Claude Code Initial Prompt

Copy and paste everything below the line into Claude Code (VS Code extension or terminal).

---

## Prompt:

Build a **Grid Futures Trading Bot** for the GRVT decentralized exchange with a Next.js dashboard. This is a monorepo project.

### Project Context
- I want to replicate Pionex's grid futures bot functionality on GRVT (grvt.io)
- The goal is to farm GRVT's airdrop by generating trading volume while profiting from grid trading
- GRVT is a DEX that uses EIP-712 signing for orders on ZKSync
- GRVT has official CCXT support (recently added) and a TypeScript SDK (`@wezzcoetzee/grvt`)
- Instruments are named like `BTC_USDT_Perp`, `ETH_USDT_Perp`
- Auth uses API Key → session cookie flow
- Orders require EIP-712 signature with an Ethereum private key
- API docs: https://api-docs.grvt.io/
- Testnet: https://testnet.grvt.io
- Prod API: https://edge.grvt.io
- Testnet API: https://edge.testnet.grvt.io

### Architecture — Turborepo Monorepo

```
grvt-grid-bot/
├── apps/
│   ├── bot/          # NestJS service — grid engine (runs 24/7)
│   └── dashboard/    # Next.js 14 App Router — config & monitoring UI
├── packages/
│   └── shared/       # Shared types, grid config interfaces, constants
├── turbo.json
├── package.json
└── .env.example
```

### 1. Bot Engine (`apps/bot`) — NestJS

**Dependencies:** `ccxt`, `@wezzcoetzee/grvt` (as fallback/reference), `ethers` (for EIP-712 signing), `@nestjs/schedule`, `typeorm` or `prisma` (for DB)

**Core Modules:**

#### `GrvtAuthModule`
- Authenticate with GRVT API using API key
- Manage session cookie lifecycle (refresh before expiry)
- Store credentials via env vars: `GRVT_API_KEY`, `GRVT_PRIVATE_KEY`, `GRVT_SUB_ACCOUNT_ID`
- Support both testnet and mainnet via `GRVT_ENV=testnet|prod`

#### `GridEngineModule`
- **Grid configuration:** upper price, lower price, number of grids, leverage (1x-50x), investment amount, instrument (e.g., `BTC_USDT_Perp`)
- **Grid calculation:** Calculate grid levels (arithmetic or geometric spacing), order sizes per level
- **Order placement:** Place limit buy orders below current price and limit sell orders above current price at each grid level
- **Order management:** When a buy fills → place corresponding sell one grid above. When a sell fills → place corresponding buy one grid below
- **Position tracking:** Track net position, unrealized PnL, realized PnL
- **Safety mechanisms:** 
  - Stop loss: cancel all orders and close position if price exits range
  - Max drawdown limit
  - Configurable take profit
  - Rate limit handling with exponential backoff

#### `MarketDataModule`
- Subscribe to real-time price updates via GRVT WebSocket (`wss://market-data.grvt.io/ws/full` for prod, `wss://market-data.testnet.grvt.io/ws/full` for testnet)
- Track orderbook for the active instrument
- Calculate mid price, spread, funding rate

#### `DatabaseModule`
- **Grid entity:** id, instrument, upperPrice, lowerPrice, gridCount, leverage, status (active/stopped/error), createdAt
- **Order entity:** id, gridId, gridLevel, side (buy/sell), price, size, status (pending/filled/cancelled), grvtOrderId, filledAt
- **Trade entity:** id, gridId, buyOrderId, sellOrderId, profit, timestamp
- **PnL snapshot entity:** periodic snapshots of realized + unrealized PnL
- Use PostgreSQL (Supabase connection string via `DATABASE_URL`)

#### `NotificationModule` (optional phase 2)
- Telegram bot for alerts (fills, errors, stop loss triggered)

### 2. Dashboard (`apps/dashboard`) — Next.js 14

**Dependencies:** `shadcn/ui`, `recharts`, `tailwindcss`, `tanstack/react-query`

**Pages:**

#### `/` — Dashboard Home
- Active grids summary cards (PnL, volume generated, # of trades)
- Current price chart with grid levels overlayed
- Recent fills table

#### `/grids` — Grid Management
- List of all grids (active, stopped, completed)
- "New Grid" button → form to configure: instrument, price range, grid count, leverage, investment amount
- Start/Stop/Delete actions per grid

#### `/grids/[id]` — Grid Detail
- Price chart with grid lines drawn
- Order book visualization
- All orders for this grid with status
- PnL chart over time (realized + unrealized)
- Trade history table

#### `/settings` — Settings
- GRVT API key configuration (encrypted storage)
- Environment toggle (testnet/mainnet)
- Default parameters

**API Routes** (Next.js Route Handlers):
- `GET/POST /api/grids` — CRUD for grid configurations
- `GET /api/grids/[id]/orders` — orders for a grid
- `GET /api/grids/[id]/pnl` — PnL data
- `POST /api/grids/[id]/start` — start grid
- `POST /api/grids/[id]/stop` — stop grid
- The dashboard connects to the same Supabase DB as the bot
- Real-time updates via polling (every 5s) or SSE

### 3. Shared Package (`packages/shared`)

```typescript
// Grid config type
interface GridConfig {
  instrument: string;        // e.g., "BTC_USDT_Perp"
  upperPrice: number;
  lowerPrice: number;
  gridCount: number;         // number of grid levels
  gridType: 'arithmetic' | 'geometric';
  leverage: number;          // 1-50
  investmentAmount: number;  // in USDT
  stopLoss?: number;
  takeProfit?: number;
}

// Grid status
type GridStatus = 'pending' | 'active' | 'stopped' | 'error' | 'completed';
```

### GRVT-Specific Implementation Notes

1. **Authentication flow:**
   ```
   POST https://edge.{env}.grvt.io/auth/api_key/login
   Body: { "api_key": "YOUR_KEY" }
   Response: Set-Cookie: gravity=...; + X-Grvt-Account-Id header
   ```
   Use the cookie for all subsequent requests.

2. **Order signing:** GRVT requires EIP-712 typed data signatures for orders. Use `ethers.js` to sign with the private key associated with the API key's signer address.

3. **CCXT usage for GRVT:**
   ```typescript
   import ccxt from 'ccxt';
   const exchange = new ccxt.grvt({
     apiKey: process.env.GRVT_API_KEY,
     secret: process.env.GRVT_PRIVATE_KEY,
     options: {
       subAccountId: process.env.GRVT_SUB_ACCOUNT_ID,
       network: process.env.GRVT_ENV === 'prod' ? 'mainnet' : 'testnet',
     }
   });
   ```

4. **Instruments:** Always query available instruments first via `GET /full/v1/all_instruments`. Perpetuals use format `{BASE}_{QUOTE}_Perp`.

5. **Rate limits:** Implement exponential backoff. GRVT has rate limits on API calls.

6. **WebSocket for fills:** Subscribe to order fill events to trigger grid rebalancing in real-time rather than polling.

### Development Phases

**Phase 1 (MVP — start here):**
- Bot: GRVT auth + single grid with arithmetic spacing + order placement/management via CCXT
- Dashboard: Grid creation form + active grid status + basic PnL display
- Test on GRVT testnet with minted tokens

**Phase 2:**
- Geometric grid spacing
- Multiple simultaneous grids
- Advanced PnL analytics and charts
- Telegram notifications

**Phase 3:**
- Multi-exchange support (leverage CCXT abstraction)
- Backtesting module with historical data
- Auto-optimization of grid parameters

### Tech Requirements
- Node.js 20+
- pnpm as package manager
- TypeScript strict mode
- ESLint + Prettier
- Environment variables via `.env` files (never commit secrets)
- Docker support for bot deployment

### Start with:
1. Initialize Turborepo monorepo with pnpm
2. Set up the NestJS bot app with basic GRVT authentication via CCXT
3. Set up the Next.js dashboard with shadcn/ui
4. Create the shared types package
5. Implement the grid calculation logic
6. Create a simple test that connects to GRVT testnet, fetches BTC_USDT_Perp ticker, and places a small limit order

Please proceed step by step, starting with project scaffolding.
