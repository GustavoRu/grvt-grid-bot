# GRVT Grid Trading Bot — Project Plan & Status

> Este archivo vive en la raíz del repo y se actualiza en cada sesión de trabajo.
> Última actualización: 2026-04-05

---

## Objetivo

Crear un bot de grid trading (futures) que opere sobre GRVT (grvt.io) via API, replicando la funcionalidad de los bots de Pionex, con un dashboard web para configuración y monitoreo. Objetivo dual: generar profit con grid trading + farmear el airdrop de GRVT generando volumen.

---

## Stack Tecnológico

| Componente | Tecnología | Justificación |
|---|---|---|
| Monorepo | Turborepo + pnpm | Compartir tipos, un solo repo |
| Bot Engine | NestJS (Node.js) | Gustavo ya lo maneja, robusto para servicios 24/7 |
| Dashboard | Next.js 14 (App Router) | SSR, API routes, deploy gratis en Vercel |
| Exchange SDK | CCXT (oficial con GRVT) | Abstracción unificada, portabilidad a otros exchanges |
| Base de datos | PostgreSQL (Supabase) | Free tier generoso, ya usado en otros proyectos |
| UI Components | shadcn/ui + Tailwind | Rápido, personalizable, ya conocido |
| Charts | Recharts o Lightweight Charts | Visualización de grillas y PnL |
| Hosting Bot | Railway (Hobby plan) | $5/mes con crédito incluido, deploy fácil |
| Hosting Dashboard | Vercel | Free tier, óptimo para Next.js |

---

## Fases del Proyecto

### FASE 0 — Setup & Fundamentos
**Estado: ✅ Completada**

**Completado:**
- [x] Scaffolding monorepo (Turborepo + pnpm)
- [x] Setup apps/bot (NestJS) con todos los módulos
- [x] Setup apps/dashboard (Next.js 14) base con shadcn/ui
- [x] Setup packages/shared (tipos e interfaces)
- [x] Prisma schema con Grid, GridOrder, GridTrade, PnlSnapshot
- [x] GridCalculator (arithmetic + geometric spacing)
- [x] GrvtAuthModule (session cookie + auto-refresh)
- [x] GrvtExchangeService (CCXT wrapper)
- [x] MarketDataModule (WebSocket con reconexión)
- [x] Script de test de conexión: `pnpm test:grvt`
- [x] API key GRVT testnet configurada (TradingAccount1, sub-account: 7475784914520631)
- [x] Supabase DB creada (grvt-grid-bot, us-east-1, pooler configurado)
- [x] `apps/bot/.env` como symlink al `.env` raíz (un solo archivo de config)
- [x] `prisma migrate dev --name init` ejecutado — tablas creadas en Supabase
- [x] TypeScript compila sin errores en todos los workspaces

**`pnpm test:grvt` ✅ PASÓ** — 113 mercados, BTC price $67,274, grid levels calculados correctamente

**Pendiente antes de Fase 1:**
- [ ] Mintear USDT testnet en https://testnet.grvt.io → Faucet → transferir a Trading Account
- [ ] `PLACE_ORDER=true pnpm test:grvt` para verificar placement de órdenes

**Entregable:** Bot se conecta a GRVT testnet, consulta precio, coloca una orden de prueba.

---

### FASE 1 — Grid Engine MVP
**Estado: 🟡 Parcialmente implementado (backend alineado con Pionex)**
**Objetivo:** Grid bot funcional con una grilla arithmetic en un solo par.

**Ya implementado:**
- [x] Lógica de cálculo de grid levels (arithmetic + geometric)
- [x] Módulo de colocación de órdenes iniciales
- [x] Polling de fills + rebalanceo automático
- [x] Tracking de PnL realizado + snapshots
- [x] Safety: stop loss y take profit por precio
- [x] direction (long/short/neutral), entryPrice, fundingPnl en DB y tipos compartidos
- [x] FundingPayment model para historial de financiación
- [x] Controller con endpoints completos: stats, orders, trades, funding, pnl
- [x] getStats(): APR anualizado, rounds24h, profitPerGridPct, daysActive, trendPnl
- [x] Migración DB: `add-direction-funding` aplicada en Supabase

**Pendiente Fase 1:**
- [ ] Listener WebSocket de fills (reemplazar polling)
- [ ] Manejo de leverage (setLeverage en GRVT)
- [ ] Logging estructurado más detallado
- [ ] Test de integración completo en testnet

**Entregable:** Bot corre una grilla completa en testnet, genera trades, trackea PnL.

---

### FASE 2 — Dashboard MVP
**Estado: 🟢 MVP completo**
**Objetivo:** Dashboard web para crear, monitorear y detener grillas.

**Ya implementado:**
- [x] Layout + sidebar de navegación
- [x] Página Home con summary cards
- [x] Página Grids: lista con acciones, filas clickeables, columna dirección con íconos
- [x] Formulario "Nueva Grilla": selector de dirección (Long/Short/Neutral) con íconos + descripción
- [x] React Query con polling automático (10s grids, 15s stats, 30s chart)
- [x] Página detalle `/grids/[id]` con 5 tabs:
  - **Summary**: 8 métricas (APR, rondas, PnL desglosado) + gráfico de PnL con Recharts
  - **Orders**: tabla filtrable por estado, color coding buy/sell, badges de estado
  - **Trades**: historial de rondas completadas, profit acumulado
  - **Parameters**: vista read-only de configuración de la grilla
  - **Funding**: historial de pagos de financiación con neto total

**Pendiente Fase 2:**
- [ ] API routes en Next.js (actualmente habla directo al bot — ok para desarrollo)
- [ ] Auth básica (JWT o cookie simple)

---

### FASE 3 — Hardening & Features
**Estado: ⬜ Pendiente**
**Objetivo:** Robustez y features avanzados.

- [ ] Múltiples grillas simultáneas
- [ ] Reconexión automática de WebSocket
- [ ] Manejo de errores robusto (reintentos, circuit breaker)
- [ ] Notificaciones Telegram (fills, errores, stop loss)
- [ ] PnL analytics avanzados (gráficos de rendimiento, drawdown)
- [ ] Take profit automático
- [ ] Deploy bot en Railway
- [ ] Deploy dashboard en Vercel

---

### FASE 4 — Expansión (futuro)
**Estado: ⬜ Pendiente**

- [ ] Multi-exchange via CCXT (Hyperliquid, Binance Futures)
- [ ] Backtesting con datos históricos
- [ ] Auto-optimización de parámetros de grilla
- [ ] Multi-usuario (SaaS potential)

---

## Estructura del Monorepo

```
grvt-grid-bot/
├── apps/
│   ├── bot/                     # NestJS service
│   │   ├── src/
│   │   │   ├── auth/            # GrvtAuthModule (session cookie)
│   │   │   ├── grid-engine/     # GridEngineModule + GrvtExchangeService
│   │   │   ├── market-data/     # WebSocket market data
│   │   │   ├── database/        # PrismaService
│   │   │   └── scripts/         # test-grvt-connection.ts
│   │   └── prisma/
│   │       └── schema.prisma    # Grid, GridOrder, GridTrade, PnlSnapshot
│   └── dashboard/               # Next.js 14 App Router
│       └── src/
│           ├── app/             # Pages: /, /grids, /settings
│           ├── components/      # dashboard, grids, layout
│           └── lib/             # api.ts, utils.ts
└── packages/
    └── shared/                  # Tipos compartidos: GridConfig, Grid, etc.
```

---

## Comandos Rápidos

```bash
# Setup inicial (una sola vez)
pnpm install
pnpm --filter bot exec prisma generate
pnpm --filter bot exec prisma migrate dev --name init

# Test de conexión GRVT testnet
pnpm --filter bot run test:grvt

# Test con colocación de orden real
PLACE_ORDER=true pnpm --filter bot run test:grvt

# Desarrollo
pnpm bot          # Solo bot (NestJS en :3001)
pnpm dashboard    # Solo dashboard (Next.js en :3000)
pnpm dev          # Ambos en paralelo

# Build
pnpm build
```

---

## Variables de Entorno Requeridas

```env
# GRVT
GRVT_API_KEY=                    # API key generada en GRVT (opción "Generar")
GRVT_PRIVATE_KEY=                # Private key del signer Ethereum (para EIP-712)
GRVT_SUB_ACCOUNT_ID=             # Sub-account ID de GRVT
GRVT_ENV=testnet                 # testnet | prod

# Database
DATABASE_URL=                    # Supabase PostgreSQL connection string

# Bot
BOT_PORT=3001

# Dashboard
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Endpoints Clave de GRVT

| Acción | Endpoint | Método |
|---|---|---|
| Auth (API Key) | `https://edge.{env}.grvt.io/auth/api_key/login` | POST |
| Listar instrumentos | `/full/v1/all_instruments` | GET |
| Obtener ticker | `/full/v1/ticker` | GET |
| Colocar orden | `/full/v1/create_order` | POST |
| Cancelar orden | `/full/v1/cancel_order` | POST |
| Cancelar todas | `/full/v1/cancel_all_orders` | POST |
| Órdenes abiertas | `/full/v1/open_orders` | GET |
| Posiciones | `/full/v1/positions` | GET |
| WebSocket Market Data | `wss://market-data.{env}.grvt.io/ws/full` | WS |
| WebSocket Trading | `wss://trades.{env}.grvt.io/ws/full` | WS |

---

## Notas de Sesión

### 2026-04-04 — Sesión 1: Planificación
- Investigamos la API de GRVT: tiene soporte CCXT oficial (game-changer)
- Existe SDK TypeScript de la comunidad: `@wezzcoetzee/grvt`
- GRVT requiere firma EIP-712 para órdenes (no es un simple API key como Binance)
- Decidimos usar CCXT como capa de abstracción principal
- Arquitectura: NestJS (bot) + Next.js (dashboard) + Supabase (DB) en monorepo Turborepo
- Hosting: Railway ($5/mes con crédito) para bot, Vercel gratis para dashboard

### 2026-04-05 — Sesión 3: Alineación Pionex + Dashboard completo (Claude Code)
- Backend alineado con UI de Pionex: direction, entryPrice, fundingPnl, FundingPayment model
- Migración DB `add-direction-funding` aplicada en Supabase
- Controller reescrito con endpoints para cada tab: stats, orders, trades, funding, pnl
- getStats() calcula APR anualizado, rounds24h, profitPerGrid, trendPnl, daysActive
- Dashboard: formulario de nueva grilla con selector de dirección visual
- Dashboard: filas de grillas clickeables → detalle, auto-refresh, ícono de dirección
- Dashboard: página `/grids/[id]` con 5 tabs (Summary, Orders, Trades, Parameters, Funding)
- TypeScript limpio en todos los workspaces ✅

### 2026-04-04 — Sesión 2: Scaffolding completo (Claude Code)
- Monorepo Turborepo completo con pnpm workspaces
- `packages/shared`: tipos GridConfig, Grid, GridOrder, GridTrade, PnlSnapshot, GrvtTicker, etc.
- `apps/bot`: NestJS con GrvtAuthModule, GridEngineModule, MarketDataModule, DatabaseModule
  - GridCalculator: arithmetic + geometric spacing, split por precio actual
  - GrvtExchangeService: wrapper CCXT completo (orders, positions, balance)
  - MarketDataService: WebSocket con reconexión exponencial backoff
  - GrvtAuthService: auth con session cookie + auto-refresh
  - PrismaService + schema completo
- `apps/dashboard`: Next.js 14 con Tailwind dark theme
  - Home page: summary cards + tabla de grillas activas
  - Grids page: lista + form de nueva grilla (modal)
  - React Query polling cada 5s
- Script `test-grvt-connection.ts`: verifica auth, ticker, grid levels, balance
- TypeScript compila ✅ en todos los workspaces
- Repo en GitHub: GustavoRu/grvt-grid-bot

**Próximo paso:** Gustavo crea API key en GRVT testnet → `cp .env.example .env` → `pnpm test:grvt`

---

## Decisiones de Diseño

1. **CCXT sobre API raw:** Portabilidad entre exchanges, documentación amplia, menos código custom
2. **NestJS sobre Express puro:** Módulos, DI, schedulers, mejor estructura para servicio 24/7
3. **Monorepo sobre repos separados:** Compartir tipos, desarrollo más ágil
4. **Railway sobre VPS:** Deploy más simple, no requiere sysadmin, pricing justo
5. **Arithmetic grid primero:** Más simple de implementar, después agregamos geometric
6. **Testnet first:** Iterar sin riesgo de perder plata real

---

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Bug en grid engine con leverage | Liquidación | Testear extensivamente en testnet, empezar con 2x |
| Rate limits de GRVT | Bot se frena | Exponential backoff, throttling de órdenes |
| WebSocket se desconecta | Órdenes huérfanas | Reconexión automática + reconciliación periódica |
| GRVT cambia API | Bot deja de funcionar | CCXT abstrae cambios, monitorear changelogs |
| Session cookie expira | Auth fails | Auto-refresh del cookie antes de expiración |
| GRVT no disponible en Argentina | No poder acceder | VPN si es necesario, API no tiene restricción geográfica |
