---
name: exchange-debug
description: Diagnose exchange/bot state mismatches. Use when orders are missing, PnL shows $0, bot seems stuck, or after recovering from Mac sleep/crash.
disable-model-invocation: false
allowed-tools: Read Bash Grep
---

Run the exchange-bot diagnostic checklist for $ARGUMENTS (instrument name, or 'all' if not specified).

## Diagnostic steps

### 1. Read the CLAUDE.md quirks section
Read `/Users/gustavo/Projects/grvt-grid-bot/CLAUDE.md` — focus on sections:
- `expirationSeconds` setting
- `0x00 order ID`
- `Open order limit`

### 2. Check expirationSeconds in the exchange service
Read `apps/bot/src/grid-engine/grvt-exchange.service.ts`.
Verify: `expirationSeconds: 2592000` is set in the CCXT options.
If missing or set to 30: CRITICAL — all orders expire in 30 seconds.

### 3. Check for 0x00 orders in DB
Run via the bot's Prisma client (check the query):
```bash
cd /Users/gustavo/Projects/grvt-grid-bot/apps/bot
npx prisma studio
```
Or grep for 0x00 in recent logs:
```bash
grep -n "0x00\|0x0000" apps/bot/logs/*.log 2>/dev/null | tail -20
```

### 4. Check pollOrderFills reconciliation
Read `apps/bot/src/grid-engine/grid-engine.service.ts`, search for `reconciled 0x00`.
Verify the reconciliation block exists (not just "marking as error").

### 5. Check unrealizedPnl polling
Read `grid-engine.service.ts`, search for `pollPositionPnl`.
Verify `@Interval(30000)` exists and calls `exchange.getPosition`.

### 6. Check periodic PnL snapshot
Search for `periodicPnlSnapshot` — must exist with `@Interval(300000)`.

### 7. Check recovery logic
Search for `recoverActiveGrids` — verify it calls `getRecentOrders` before marking orders cancelled.

## Output format

For each check, print:
```
[CHECK NAME]  ✅ OK / ❌ BROKEN / ⚠️ WARN
Details: ...
```

End with a prioritized list of issues found and the exact file+line to fix each one.

## Key files to check

- `apps/bot/src/grid-engine/grid-engine.service.ts` — main logic
- `apps/bot/src/grid-engine/grvt-exchange.service.ts` — CCXT wrapper
- `apps/bot/.env` — BOT_PORT, GRVT_ENV
