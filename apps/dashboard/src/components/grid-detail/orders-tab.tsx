'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUsd, formatDate } from '@/lib/utils';
import type { GridOrder } from '@grvt-grid-bot/shared';

const STATUS_FILTERS = ['all', 'open', 'filled', 'cancelled', 'error'];

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-yellow-500/10 text-yellow-400',
  filled: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-muted text-muted-foreground',
  pending: 'bg-blue-500/10 text-blue-400',
  error: 'bg-red-500/10 text-red-400',
};

interface Props {
  id: string;
}

export function OrdersTab({ id }: Props) {
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: orders = [], isLoading } = useQuery<GridOrder[]>({
    queryKey: ['grid-orders', id, statusFilter],
    queryFn: () => api.grids.orders(id, statusFilter === 'all' ? undefined : statusFilter),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs capitalize transition-colors ${
              statusFilter === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">No orders found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-left p-3">Level</th>
                <th className="text-left p-3">Side</th>
                <th className="text-right p-3">Price</th>
                <th className="text-right p-3">Size</th>
                <th className="text-right p-3">Fill Price</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Filled At</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: GridOrder) => (
                <tr key={o.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="p-3 text-muted-foreground">#{o.gridLevel}</td>
                  <td className="p-3">
                    <span
                      className={`font-medium uppercase text-xs ${
                        o.side === 'buy' ? 'text-green-400' : 'text-red-400'
                      }`}
                    >
                      {o.side}
                    </span>
                  </td>
                  <td className="p-3 text-right">{formatUsd(o.price, 0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{o.size}</td>
                  <td className="p-3 text-right">
                    {o.filledPrice ? formatUsd(o.filledPrice, 0) : '—'}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATUS_BADGE[o.status] ?? 'text-muted-foreground'}`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="p-3 text-right text-muted-foreground text-xs">
                    {o.filledAt ? formatDate(o.filledAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
