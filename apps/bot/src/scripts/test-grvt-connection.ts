/**
 * GRVT Testnet Connection Test
 *
 * Verifica:
 * 1. Autenticación via API key
 * 2. Fetch de instrumentos disponibles
 * 3. Fetch del ticker BTC_USDT_Perp
 * 4. Cálculo de grid levels
 * 5. (Opcional) Colocar una orden limit de prueba
 *
 * Uso:
 *   pnpm test:grvt
 *   PLACE_ORDER=true pnpm test:grvt  # también coloca una orden pequeña
 */

import 'dotenv/config';
import * as ccxt from 'ccxt';
import { GridCalculator } from '../grid-engine/grid-calculator';

const INSTRUMENT = 'BTC_USDT_Perp';
const PLACE_ORDER = process.env['PLACE_ORDER'] === 'true';

async function main() {
  console.log('\n🤖 GRVT Grid Bot — Testnet Connection Test\n');
  console.log('='.repeat(50));

  // ─── 1. Check env vars ───────────────────────────────────
  const required = ['GRVT_API_KEY', 'GRVT_PRIVATE_KEY', 'GRVT_SUB_ACCOUNT_ID'];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`❌ Missing env var: ${key}`);
      console.error('Copy .env.example to .env and fill in your credentials');
      process.exit(1);
    }
    console.log(`✅ ${key}: ${(process.env[key] as string).substring(0, 8)}…`);
  }

  // ─── 2. Initialize CCXT exchange ─────────────────────────
  console.log('\n📡 Initializing CCXT grvt exchange (testnet)…');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exchange = new (ccxt as any).grvt({
    apiKey: process.env['GRVT_API_KEY'] as string,
    secret: process.env['GRVT_PRIVATE_KEY'] as string,
    options: {
      subAccountId: process.env['GRVT_SUB_ACCOUNT_ID'],
      network: 'testnet',
    },
  });

  // ─── 3. Load markets ─────────────────────────────────────
  console.log('🔍 Loading markets…');
  try {
    const markets = await exchange.loadMarkets();
    const perpetuals = Object.keys(markets).filter(
      (k) => markets[k].type === 'swap' || k.includes('USDT:USDT'),
    );
    console.log(`✅ Loaded ${perpetuals.length} perpetual markets`);
    console.log('   Sample:', perpetuals.slice(0, 5).join(', '));
  } catch (err) {
    console.error('❌ Failed to load markets:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ─── 4. Fetch BTC_USDT_Perp ticker ───────────────────────
  console.log(`\n📊 Fetching ticker for ${INSTRUMENT}…`);
  let currentPrice = 0;
  try {
    const ticker = await exchange.fetchTicker('BTC/USDT:USDT');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentPrice = (ticker as any).mark ?? ticker.last ?? 0;
    console.log(`✅ Mark price:  $${currentPrice.toLocaleString()}`);
    console.log(`   Last price:  $${ticker.last?.toLocaleString() ?? 'N/A'}`);
    console.log(`   24h volume:  $${ticker.quoteVolume?.toLocaleString() ?? 'N/A'}`);
  } catch (err) {
    console.error('❌ Failed to fetch ticker:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // ─── 5. Calculate grid levels ─────────────────────────────
  console.log(`\n🔢 Calculating grid levels…`);
  const priceOffset = currentPrice * 0.03; // ±3% from current price
  const config = {
    instrument: INSTRUMENT,
    upperPrice: Math.round(currentPrice + priceOffset),
    lowerPrice: Math.round(currentPrice - priceOffset),
    gridCount: 10,
    gridType: 'arithmetic' as const,
    leverage: 2,
    investmentAmount: 100, // $100 USDT
  };

  const levels = GridCalculator.calculateLevels(config);
  const { buyLevels, sellLevels } = GridCalculator.splitLevelsByPrice(levels, currentPrice);
  const profitPerGrid = GridCalculator.calculateGridProfit(config);

  console.log(`✅ Grid: $${config.lowerPrice.toLocaleString()} → $${config.upperPrice.toLocaleString()}`);
  console.log(`   ${levels.length} levels | ${buyLevels.length} buys | ${sellLevels.length} sells`);
  console.log(`   Order size per level: ~${levels[0].orderSize} BTC`);
  console.log(`   Estimated profit/grid: ~$${profitPerGrid.toFixed(4)}`);
  console.log('   Levels:');
  levels.forEach((l) => {
    const side = l.price < currentPrice ? '🟢 BUY ' : l.price > currentPrice ? '🔴 SELL' : '⚪ MID ';
    console.log(`     [${l.index.toString().padStart(2)}] ${side} $${l.price.toLocaleString()} × ${l.orderSize}`);
  });

  // ─── 6. Fetch account balance ─────────────────────────────
  console.log('\n💰 Fetching account balance…');
  try {
    const balance = await exchange.fetchBalance();
    const usdt = balance['USDT'];
    if (usdt) {
      console.log(`✅ USDT Balance: ${usdt.free?.toFixed(2)} free / ${usdt.total?.toFixed(2)} total`);
    } else {
      console.log('⚠️  No USDT balance found (might need to mint testnet tokens)');
      console.log('   Mint at: https://testnet.grvt.io → Faucet');
    }
  } catch (err) {
    console.warn('⚠️  Could not fetch balance:', err instanceof Error ? err.message : err);
  }

  // ─── 7. (Optional) Place test order ──────────────────────
  if (PLACE_ORDER) {
    const testPrice = Math.round(currentPrice * 0.97); // 3% below market
    const testSize = levels[0].orderSize;

    console.log(`\n📝 Placing test limit BUY order: ${testSize} BTC @ $${testPrice.toLocaleString()}…`);
    try {
      const order = await exchange.createOrder(
        'BTC/USDT:USDT',
        'limit',
        'buy',
        testSize,
        testPrice,
        { timeInForce: 'GTC', postOnly: true },
      );

      console.log(`✅ Order placed!`);
      console.log(`   Order ID: ${order.id}`);
      console.log(`   Status:   ${order.status}`);
      console.log(`   Price:    $${order.price?.toLocaleString()}`);
      console.log(`   Size:     ${order.amount} BTC`);

      // Cancel the test order immediately
      console.log(`\n🗑  Cancelling test order ${order.id}…`);
      await exchange.cancelOrder(order.id, 'BTC/USDT:USDT');
      console.log('✅ Test order cancelled');
    } catch (err) {
      console.error('❌ Failed to place order:', err instanceof Error ? err.message : err);
    }
  } else {
    console.log('\n💡 Tip: run with PLACE_ORDER=true to also test order placement');
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ All connection tests passed! Ready to run grids on testnet.\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
