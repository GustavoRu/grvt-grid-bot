'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { api } from '@/lib/api';
import { formatUsd, formatPct, formatDate } from '@/lib/utils';
import type { Grid, GridStats, PnlSnapshot } from '@grvt-grid-bot/shared';

interface Props {
  id: string;
  grid: Grid;
}

export function StatsTab({ id, grid }: Props) {
  const { data: stats } = useQuery<GridStats>({
    queryKey: ['grid-stats', id],
    queryFn: () => api.grids.stats(id),
    refetchInterval: 15_000,
  });

  const { data: pnlData = [] } = useQuery<PnlSnapshot[]>({
    queryKey: ['grid-pnl', id],
    queryFn: () => api.grids.pnl(id),
    refetchInterval: 30_000,
  });

  const chartData = pnlData.map((s) => ({
    time: formatDate(s.timestamp),
    totalPnl: s.totalPnl,
    gridPnl: s.realizedPnl,
    trendPnl: s.unrealizedPnl,
  }));

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MetricCard label="Total PnL" value={formatUsd(stats.totalPnl)} sub={formatPct(stats.totalPnlPct)} highlight={stats.totalPnl >= 0 ? 'green' : 'red'} />
          <MetricCard label="Grid PnL" value={formatUsd(stats.gridPnl)} sub="realized" highlight={stats.gridPnl >= 0 ? 'green' : 'red'} />
          <MetricCard label="Trend PnL" value={formatUsd(stats.trendPnl)} sub="unrealized position" highlight={stats.trendPnl >= 0 ? 'green' : 'red'} />
          <MetricCard label="Funding PnL" value={formatUsd(stats.fundingPnl)} sub="cumulative" highlight={stats.fundingPnl >= 0 ? 'green' : 'red'} />
          <MetricCard label="APR (Grid)" value={`${stats.aprGrid.toFixed(1)}%`} sub="annualized" highlight="blue" />
          <MetricCard label="APR (Total)" value={`${stats.aprTotal.toFixed(1)}%`} sub="annualized" highlight="blue" />
          <MetricCard label="Rounds (24h)" value={String(stats.rounds24h)} sub={`${stats.roundsTotal} total`} />
          <MetricCard label="Profit/Grid" value={formatPct(stats.profitPerGridPct)} sub={`${stats.daysActive.toFixed(1)} days active`} />
        </div>
      ) : (
        <div className="text-muted-foreground text-sm">Loading stats…</div>
      )}

      {/* Entry price info */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>Entry price: <span className="text-foreground">{formatUsd(grid.entryPrice, 0)}</span></span>
        {grid.currentPrice && (
          <span>Current price: <span className="text-foreground">{formatUsd(grid.currentPrice, 0)}</span></span>
        )}
        <span>Investment: <span className="text-foreground">{formatUsd(grid.investmentAmount, 0)}</span></span>
      </div>

      {/* PnL Chart */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium mb-4">PnL Over Time</h3>
        {chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
            No data yet — PnL snapshots are recorded every 5 minutes
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                formatter={(value: number) => [formatUsd(value), '']}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="totalPnl"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
                name="Total PnL"
              />
              <Line
                type="monotone"
                dataKey="gridPnl"
                stroke="#4ade80"
                strokeWidth={1.5}
                dot={false}
                name="Grid PnL"
                strokeDasharray="4 2"
              />
              <Line
                type="monotone"
                dataKey="trendPnl"
                stroke="#f87171"
                strokeWidth={1.5}
                dot={false}
                name="Trend PnL"
                strokeDasharray="4 2"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: 'green' | 'red' | 'blue';
}) {
  const valueClass =
    highlight === 'green'
      ? 'text-green-400'
      : highlight === 'red'
        ? 'text-red-400'
        : highlight === 'blue'
          ? 'text-blue-400'
          : 'text-foreground';

  return (
    <div className="bg-background border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-base font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
