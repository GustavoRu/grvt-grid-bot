# GRVT Grid Trading Bot — Project Plan & Status

> Este archivo vive en la raíz del repo y se actualiza en cada sesión de trabajo.
> Última actualización: 2026-04-04

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

### FASE 0 — Setup & Fundamentos ← ACTUAL
**Estado: 🟡 En progreso**
**Objetivo:** Tener el proyecto scaffolded, conectado a GRVT testnet, y poder hacer operaciones básicas.

- [ ] Crear cuenta GRVT testnet + API key (método "Generar")
- [ ] Mintear tokens de prueba en testnet
- [ ] Transferir fondos a Trading Account
- [ ] Scaffolding monorepo (Turborepo + pnpm)
- [ ] Setup apps/bot (NestJS) con módulo de auth GRVT
- [ ] Setup apps/dashboard (Next.js 14) base
- [ ] Setup packages/shared (tipos)
- [ ] Test de conexión: autenticar → obtener ticker BTC_USDT_Perp → colocar orden limit
- [ ] Crear `.env.example` con todas las variables necesarias
- [ ] Setup base de datos (schema Prisma) en Supabase
- [ ] Commit inicial + push a GitHub

**Entregable:** Bot se conecta a GRVT testnet, consulta precio, coloca una orden de prueba.

---

### FASE 1 — Grid Engine MVP
**Estado: ⬜ Pendiente**
**Objetivo:** Grid bot funcional con una grilla arithmetic en un solo par.

- [ ] Lógica de cálculo de grid levels (arithmetic spacing)
- [ ] Módulo de colocación de órdenes: N buy limits abajo del precio, N sell limits arriba
- [ ] Listener de fills (via WebSocket o polling)
- [ ] Rebalanceo: buy fill → colocar sell un nivel arriba, y viceversa
- [ ] Tracking de posición neta y PnL
- [ ] Manejo de leverage (setear en la cuenta de GRVT)
- [ ] Safety: stop loss si el precio sale del rango
- [ ] Persistencia en DB: grilla activa, órdenes, trades
- [ ] Logging estructurado de toda la actividad

**Entregable:** Bot corre una grilla completa en testnet, genera trades, trackea PnL.

📸 *En esta fase pedir capturas de Pionex: formulario de creación de grid futures, vista de grilla activa.*

---

### FASE 2 — Dashboard MVP
**Estado: ⬜ Pendiente**
**Objetivo:** Dashboard web para crear, monitorear y detener grillas.

- [ ] Página Home: resumen de grillas activas, PnL total, volumen generado
- [ ] Página Grids: lista de grillas, botón "Nueva Grilla"
- [ ] Formulario de creación: par, rango de precio, cantidad de grids, leverage, monto
- [ ] Página de detalle de grilla: gráfico con niveles, órdenes, PnL
- [ ] Start/Stop de grillas desde el dashboard
- [ ] Tabla de historial de trades
- [ ] API routes que leen de la misma DB que el bot
- [ ] Auth básica (password simple o Supabase auth)

**Entregable:** Dashboard funcional que permite crear y monitorear grillas.

📸 *En esta fase pedir capturas de Pionex: dashboard principal, detalle de bot activo, historial de PnL.*

---

### FASE 3 — Hardening & Features
**Estado: ⬜ Pendiente**
**Objetivo:** Robustez y features avanzados.

- [ ] Grid geométrico (spacing proporcional)
- [ ] Múltiples grillas simultáneas
- [ ] Reconexión automática de WebSocket
- [ ] Manejo de errores robusto (reintentos, circuit breaker)
- [ ] Notificaciones Telegram (fills, errores, stop loss)
- [ ] PnL analytics avanzados (gráficos de rendimiento, drawdown)
- [ ] Take profit automático
- [ ] Deploy bot en Railway
- [ ] Deploy dashboard en Vercel
- [ ] Variables de entorno en producción

**Entregable:** Bot corriendo en producción sobre GRVT mainnet.

---

### FASE 4 — Expansión (futuro)
**Estado: ⬜ Pendiente**

- [ ] Multi-exchange via CCXT (Hyperliquid, Binance Futures)
- [ ] Backtesting con datos históricos
- [ ] Auto-optimización de parámetros de grilla
- [ ] Multi-usuario (SaaS potential)

---

## Variables de Entorno Requeridas

```env
# GRVT
GRVT_API_KEY=
GRVT_PRIVATE_KEY=          # Private key del signer (para EIP-712)
GRVT_SUB_ACCOUNT_ID=
GRVT_ENV=testnet            # testnet | prod

# Database
DATABASE_URL=               # Supabase PostgreSQL connection string

# Dashboard
NEXT_PUBLIC_API_URL=        # URL del bot engine API (para el dashboard)
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

**Nota:** `{env}` = vacío para prod, `testnet` para testnet. Ej: `edge.testnet.grvt.io` vs `edge.grvt.io`

---

## Notas de Sesión

### 2026-04-04 — Sesión 1: Planificación
- Investigamos la API de GRVT: tiene soporte CCXT oficial (game-changer)
- Existe SDK TypeScript de la comunidad: `@wezzcoetzee/grvt`
- GRVT requiere firma EIP-712 para órdenes (no es un simple API key como Binance)
- Decidimos usar CCXT como capa de abstracción principal
- Arquitectura: NestJS (bot) + Next.js (dashboard) + Supabase (DB) en monorepo Turborepo
- Hosting: Railway ($5/mes con crédito) para bot, Vercel gratis para dashboard
- Railway tiene trial de 30 días con $5 de crédito sin tarjeta
- Gustavo debe crear API key en GRVT testnet (opción "Generar")
- Próximo paso: Gustavo crea API key → arrancamos Fase 0 con Claude Code

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
