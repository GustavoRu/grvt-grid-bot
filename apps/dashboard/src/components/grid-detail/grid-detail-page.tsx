'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { api } from '@/lib/api';
import { formatUsd, formatDate } from '@/lib/utils';
import { ArrowLeft, Square, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { StatsTab } from './stats-tab';
import { OrdersTab } from './orders-tab';
import { TradesTab } from './trades-tab';
import { ParamsTab } from './params-tab';
import { FundingTab } from './funding-tab';
import type { Grid } from '@grvt-grid-bot/shared';

const STATUS_COLORS: Record<string, string> = {
  active: 'text-green-400',
  stopped: 'text-muted-foreground',
  error: 'text-red-400',
  pending: 'text-yellow-400',
  completed: 'text-blue-400',
};

const DIRECTION_ICON: Record<string, React.ElementType> = {
  long: TrendingUp,
  short: TrendingDown,
  neutral: Minus,
};

const DIRECTION_COLOR: Record<string, string> = {
  long: 'text-green-400',
  short: 'text-red-400',
  neutral: 'text-blue-400',
};

const DIRECTION_LABEL: Record<string, string> = {
  long: 'Long',
  short: 'Short',
  neutral: 'Neutral',
};

interface Props {
  id: string;
}

export function GridDetailPage({ id }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: grid, isLoading } = useQuery<Grid>({
    queryKey: ['grid', id],
    queryFn: () => api.grids.get(id),
    refetchInterval: 10_000,
  });

  const stopMutation = useMutation({
    mutationFn: () => api.grids.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grid', id] });
      queryClient.invalidateQueries({ queryKey: ['grids'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">Loading…</div>
    );
  }

  if (!grid) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Grid not found
      </div>
    );
  }

  const DirIcon = DIRECTION_ICON[grid.direction] ?? Minus;
  const totalPnl = grid.realizedPnl + grid.unrealizedPnl + grid.fundingPnl;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/grids')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <h1 className="text-xl font-semibold">{grid.instrument}</h1>
          <div className={`flex items-center gap-1 text-sm ${DIRECTION_COLOR[grid.direction] ?? ''}`}>
            <DirIcon className="h-4 w-4" />
            <span>{DIRECTION_LABEL[grid.direction] ?? grid.direction}</span>
          </div>
          <span className={`text-sm capitalize ${STATUS_COLORS[grid.status] ?? ''}`}>
            · {grid.status}
          </span>
        </div>
        {grid.status === 'active' && (
          <button
            onClick={() => stopMutation.mutate()}
            disabled={stopMutation.isPending}
            className="flex items-center gap-2 border border-red-500/50 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50"
          >
            <Square className="h-3.5 w-3.5" />
            Stop Grid
          </button>
        )}
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Total PnL"
          value={formatUsd(totalPnl)}
          valueClass={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Grid PnL"
          value={formatUsd(grid.realizedPnl)}
          valueClass={grid.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}
          sub="realized"
        />
        <StatCard
          label="Trend PnL"
          value={formatUsd(grid.unrealizedPnl)}
          valueClass={grid.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}
          sub="unrealized"
        />
        <StatCard
          label="Rounds"
          value={String(grid.tradeCount)}
          sub={`since ${formatDate(grid.createdAt)}`}
        />
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="stats" className="space-y-4">
        <Tabs.List className="flex gap-1 border-b border-border">
          {[
            { value: 'stats', label: 'Summary' },
            { value: 'orders', label: 'Orders' },
            { value: 'trades', label: 'Trades' },
            { value: 'params', label: 'Parameters' },
            { value: 'funding', label: 'Funding' },
          ].map(({ value, label }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="px-4 py-2 text-sm text-muted-foreground border-b-2 border-transparent -mb-px transition-colors data-[state=active]:text-foreground data-[state=active]:border-primary hover:text-foreground"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="stats">
          <StatsTab id={id} grid={grid} />
        </Tabs.Content>
        <Tabs.Content value="orders">
          <OrdersTab id={id} />
        </Tabs.Content>
        <Tabs.Content value="trades">
          <TradesTab id={id} />
        </Tabs.Content>
        <Tabs.Content value="params">
          <ParamsTab grid={grid} />
        </Tabs.Content>
        <Tabs.Content value="funding">
          <FundingTab id={id} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function StatCard({
  label,
  value,
  valueClass = 'text-foreground',
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}
