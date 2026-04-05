'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUsd, formatDate } from '@/lib/utils';
import type { FundingPayment } from '@grvt-grid-bot/shared';

interface Props {
  id: string;
}

export function FundingTab({ id }: Props) {
  const { data: payments = [], isLoading } = useQuery<FundingPayment[]>({
    queryKey: ['grid-funding', id],
    queryFn: () => api.grids.funding(id),
    refetchInterval: 60_000,
  });

  const totalFunding = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-4">
      {payments.length > 0 && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            Total payments:{' '}
            <span className="text-foreground font-medium">{payments.length}</span>
          </span>
          <span className="text-muted-foreground">
            Net funding:{' '}
            <span className={`font-medium ${totalFunding >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {formatUsd(totalFunding)}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">
            {totalFunding >= 0 ? '(received)' : '(paid)'}
          </span>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Loading…</div>
        ) : payments.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            No funding payments recorded yet
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
                <th className="text-right p-3">Date</th>
                <th className="text-right p-3">Rate</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Type</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: FundingPayment) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="p-3 text-right text-muted-foreground text-xs">
                    {formatDate(p.timestamp)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">
                    {(p.rate * 100).toFixed(4)}%
                  </td>
                  <td
                    className={`p-3 text-right font-medium ${p.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {p.amount >= 0 ? '+' : ''}{formatUsd(p.amount)}
                  </td>
                  <td className="p-3 text-left">
                    <span
                      className={`text-xs ${p.amount >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}
                    >
                      {p.amount >= 0 ? 'Received' : 'Paid'}
                    </span>
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
