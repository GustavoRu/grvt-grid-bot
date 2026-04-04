'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/utils';
import { TrendingUp, Activity, DollarSign, BarChart2 } from 'lucide-react';
import type { Grid } from '@grvt-grid-bot/shared';

export function DashboardHome() {
  const { data: grids = [], isLoading } = useQuery({
    queryKey: ['grids'],
    queryFn: () => api.grids.list(),
  });

  const activeGrids = grids.filter((g: Grid) => g.status === 'active');
  const totalRealizedPnl = grids.reduce((sum: number, g: Grid) => sum + g.realizedPnl, 0);
  const totalVolume = grids.reduce((sum: number, g: Grid) => sum + g.totalVolume, 0);
  const totalTrades = grids.reduce((sum: number, g: Grid) => sum + g.tradeCount, 0);

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="h-4 w-4 text-primary" />}
          label="Active Grids"
          value={activeGrids.length.toString()}
        />
        <StatCard
          icon={<TrendingUp className="h-4 w-4 text-green-400" />}
          label="Realized PnL"
          value={formatUsd(totalRealizedPnl)}
          positive={totalRealizedPnl >= 0}
        />
        <StatCard
          icon={<BarChart2 className="h-4 w-4 text-blue-400" />}
          label="Total Volume"
          value={formatUsd(totalVolume, 0)}
        />
        <StatCard
          icon={<DollarSign className="h-4 w-4 text-purple-400" />}
          label="Total Trades"
          value={totalTrades.toString()}
        />
      </div>

      {/* Active grids table */}
      <div className="rounded-lg border border-border bg-card">
        <div className="p-4 border-b border-border">
          <h2 className="font-medium">Active Grids</h2>
        </div>
        {activeGrids.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No active grids. Go to{' '}
            <a href="/grids" className="text-primary hover:underline">
              Grids
            </a>{' '}
            to create one.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left p-3">Instrument</th>
                <th className="text-right p-3">Range</th>
                <th className="text-right p-3">Grids</th>
                <th className="text-right p-3">Leverage</th>
                <th className="text-right p-3">Realized PnL</th>
                <th className="text-right p-3">Trades</th>
              </tr>
            </thead>
            <tbody>
              {activeGrids.map((g: Grid) => (
                <tr key={g.id} className="border-b border-border last:border-0 hover:bg-accent/50">
                  <td className="p-3 font-medium">{g.instrument}</td>
                  <td className="p-3 text-right text-muted-foreground">
                    {formatUsd(g.lowerPrice, 0)} – {formatUsd(g.upperPrice, 0)}
                  </td>
                  <td className="p-3 text-right">{g.gridCount}</td>
                  <td className="p-3 text-right">{g.leverage}x</td>
                  <td
                    className={`p-3 text-right font-medium ${g.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {formatUsd(g.realizedPnl)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{g.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  positive,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div
        className={`text-xl font-semibold ${
          positive === undefined ? '' : positive ? 'text-green-400' : 'text-red-400'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
