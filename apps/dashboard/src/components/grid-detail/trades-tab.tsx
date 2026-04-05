'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUsd, formatDate } from '@/lib/utils';
import type { GridTrade } from '@grvt-grid-bot/shared';

interface Props {
  id: string;
}

export function TradesTab({ id }: Props) {
  const { data: trades = [], isLoading } = useQuery<GridTrade[]>({
    queryKey: ['grid-trades', id],
    queryFn: () => api.grids.trades(id),
    refetchInterval: 15_000,
  });

  const totalProfit = trades.reduce((sum, t) => sum + t.profit, 0);

  return (
    <div className="space-y-4">
      {trades.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Total rounds: <span className="text-foreground font-medium">{trades.length}</span>
          </span>
          <span className="text-muted-foreground">
            Total profit:{' '}
            <span className={`font-medium ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatUsd(totalProfit)}
            </span>
          </span>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : trades.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No completed trades yet — trades appear once a buy and sell order both fill
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-left p-3">#</th>
                <th className="text-right p-3">Buy Price</th>
                <th className="text-right p-3">Sell Price</th>
                <th className="text-right p-3">Size</th>
                <th className="text-right p-3">Profit</th>
                <th className="text-right p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: GridTrade, i: number) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="p-3 text-muted-foreground">{trades.length - i}</td>
                  <td className="p-3 text-right text-green-400/90">{formatUsd(t.buyPrice, 0)}</td>
                  <td className="p-3 text-right text-red-400/90">{formatUsd(t.sellPrice, 0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{t.size}</td>
                  <td
                    className={`p-3 text-right font-medium ${t.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {formatUsd(t.profit)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground text-xs">
                    {formatDate(t.timestamp)}
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
