'use client';

import { formatUsd, formatDate } from '@/lib/utils';
import type { Grid } from '@grvt-grid-bot/shared';

interface Props {
  grid: Grid;
}

export function ParamsTab({ grid }: Props) {
  const rows: { label: string; value: string }[] = [
    { label: 'Instrument', value: grid.instrument },
    { label: 'Direction', value: capitalize(grid.direction) },
    { label: 'Grid type', value: capitalize(grid.gridType) },
    { label: 'Grid count', value: String(grid.gridCount) },
    { label: 'Price range', value: `${formatUsd(grid.lowerPrice, 0)} – ${formatUsd(grid.upperPrice, 0)}` },
    { label: 'Entry price', value: formatUsd(grid.entryPrice, 0) },
    { label: 'Leverage', value: `${grid.leverage}x` },
    { label: 'Investment', value: formatUsd(grid.investmentAmount, 0) },
    { label: 'Stop loss', value: grid.stopLoss ? formatUsd(grid.stopLoss, 0) : 'Not set' },
    { label: 'Take profit', value: grid.takeProfit ? formatUsd(grid.takeProfit, 0) : 'Not set' },
    { label: 'Status', value: capitalize(grid.status) },
    { label: 'Created', value: formatDate(grid.createdAt) },
    ...(grid.stoppedAt ? [{ label: 'Stopped', value: formatDate(grid.stoppedAt) }] : []),
  ];

  return (
    <div className="max-w-lg">
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium text-right">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
