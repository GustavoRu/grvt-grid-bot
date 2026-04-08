---
name: grid-status
description: Show a real-time status summary of a running grid. Use when checking if a grid is healthy, how many orders are open, or what the current PnL is.
disable-model-invocation: false
allowed-tools: Read Bash Grep
---

Show the current status summary for grid $ARGUMENTS.

## What to check and display

### 1. Read the grid record from DB (via logs or source)
The bot runs at localhost:4001. Fetch via API:
```bash
curl -s http://localhost:4001/grids/$ARGUMENTS | python3 -m json.tool 2>/dev/null || echo "Bot not running or grid not found"
```

### 2. Fetch stats
```bash
curl -s http://localhost:4001/grids/$ARGUMENTS/stats | python3 -m json.tool 2>/dev/null
```

### 3. Fetch open orders
```bash
curl -s "http://localhost:4001/grids/$ARGUMENTS/orders?status=open" | python3 -c "
import json, sys
orders = json.load(sys.stdin)
buys = [o for o in orders if o['side'] == 'buy']
sells = [o for o in orders if o['side'] == 'sell']
print(f'Open orders: {len(orders)} total ({len(buys)} buys, {len(sells)} sells)')
if buys: print(f'  Buy range: \${min(o[\"price\"] for o in buys):.1f} – \${max(o[\"price\"] for o in buys):.1f}')
if sells: print(f'  Sell range: \${min(o[\"price\"] for o in sells):.1f} – \${max(o[\"price\"] for o in sells):.1f}')
" 2>/dev/null
```

### 4. Check recent trades
```bash
curl -s "http://localhost:4001/grids/$ARGUMENTS/trades" | python3 -c "
import json, sys
trades = json.load(sys.stdin)
print(f'Trades: {len(trades)} total')
if trades:
    latest = trades[0]
    print(f'  Latest: buy \${latest.get(\"buyPrice\",0):.1f} → sell \${latest.get(\"sellPrice\",0):.1f}, profit \${latest.get(\"profit\",0):.4f}')
" 2>/dev/null
```

## Output format

Print a compact status box:

```
═══════════════════════════════════
 GRID: ETH_USDT_Perp  [ACTIVE/LONG]
 Price:  entry=$X  current=$X
 PnL:    grid=$X (realized) | trend=$X (unrealized)
 Orders: X open (X buys, X sells)  window: $X–$X
 Trades: X completed | APR: X.X%
 Health: ✅ OK / ⚠️ [issue]
═══════════════════════════════════
```

Health checks:
- ⚠️ if open orders < 5 (window too thin)
- ⚠️ if no trades and grid has been active > 30 min (likely fills not being detected)
- ⚠️ if `trend PnL` is null (position PnL not being polled)
- ❌ if grid status is 'error'
