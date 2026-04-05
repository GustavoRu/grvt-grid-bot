'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { formatUsd, formatDate } from '@/lib/utils';
import { Plus, Square, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { NewGridForm } from './new-grid-form';
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

export function GridsPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: grids = [], isLoading } = useQuery({
    queryKey: ['grids'],
    queryFn: () => api.grids.list(),
    refetchInterval: 10_000,
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => api.grids.stop(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grids'] }),
  });

  if (isLoading) return <div className="text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Grids</h1>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Grid
        </button>
      </div>

      {showForm && (
        <NewGridForm
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['grids'] });
          }}
        />
      )}

      <div className="rounded-lg border border-border bg-card">
        {grids.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No grids yet. Click &quot;New Grid&quot; to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-border text-xs uppercase tracking-wide">
                <th className="text-left p-3">Instrument</th>
                <th className="text-left p-3">Dir</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Range</th>
                <th className="text-right p-3">Grids</th>
                <th className="text-right p-3">Lev.</th>
                <th className="text-right p-3">Investment</th>
                <th className="text-right p-3">Grid PnL</th>
                <th className="text-right p-3">Rounds</th>
                <th className="text-right p-3">Created</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {grids.map((g: Grid) => {
                const DirIcon = DIRECTION_ICON[g.direction] ?? Minus;
                return (
                  <tr
                    key={g.id}
                    onClick={() => router.push(`/grids/${g.id}`)}
                    className="border-b border-border last:border-0 hover:bg-accent/50 cursor-pointer"
                  >
                    <td className="p-3 font-medium">{g.instrument}</td>
                    <td className="p-3">
                      <DirIcon className={`h-4 w-4 ${DIRECTION_COLOR[g.direction] ?? ''}`} />
                    </td>
                    <td className={`p-3 capitalize ${STATUS_COLORS[g.status] ?? ''}`}>
                      {g.status}
                    </td>
                    <td className="p-3 text-right text-muted-foreground text-xs">
                      {formatUsd(g.lowerPrice, 0)} – {formatUsd(g.upperPrice, 0)}
                    </td>
                    <td className="p-3 text-right">{g.gridCount}</td>
                    <td className="p-3 text-right">{g.leverage}x</td>
                    <td className="p-3 text-right">{formatUsd(g.investmentAmount, 0)}</td>
                    <td
                      className={`p-3 text-right font-medium ${g.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                    >
                      {formatUsd(g.realizedPnl)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">{g.tradeCount}</td>
                    <td className="p-3 text-right text-muted-foreground text-xs">
                      {formatDate(g.createdAt)}
                    </td>
                    <td className="p-3 text-right">
                      {g.status === 'active' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            stopMutation.mutate(g.id);
                          }}
                          disabled={stopMutation.isPending}
                          className="p-1 hover:text-red-400 text-muted-foreground transition-colors"
                          title="Stop grid"
                        >
                          <Square className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
