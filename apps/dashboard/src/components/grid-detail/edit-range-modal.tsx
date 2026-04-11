'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Grid } from '@grvt-grid-bot/shared';

interface Props {
  grid: Grid;
  onClose: () => void;
  onUpdated: () => void;
}

export function EditRangeModal({ grid, onClose, onUpdated }: Props) {
  const [lowerPrice, setLowerPrice] = useState(String(grid.lowerPrice));
  const [upperPrice, setUpperPrice] = useState(String(grid.upperPrice));
  const [gridCount, setGridCount] = useState(String(grid.gridCount));

  const capitalPerGrid =
    (grid.investmentAmount * grid.leverage) / parseInt(gridCount || '1');

  const mutation = useMutation({
    mutationFn: () =>
      api.grids.updateRange(grid.id, {
        lowerPrice: parseFloat(lowerPrice),
        upperPrice: parseFloat(upperPrice),
        gridCount: parseInt(gridCount),
      }),
    onSuccess: onUpdated,
  });

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-sm p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold">Adjust Range</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          Current orders will be cancelled and replaced with the new range.
          PnL history and trade count are preserved.
        </p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Lower Price</label>
              <input
                type="number"
                value={lowerPrice}
                onChange={(e) => setLowerPrice(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Upper Price</label>
              <input
                type="number"
                value={upperPrice}
                onChange={(e) => setUpperPrice(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1">Number of Grids</label>
            <input
              type="number"
              value={gridCount}
              min={2}
              max={200}
              onChange={(e) => setGridCount(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            />
          </div>

          {/* Math preview */}
          <div className="bg-accent/50 rounded-md p-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Capital/grid</span>
              <span className={capitalPerGrid < 21 ? 'text-red-400 font-medium' : 'text-green-400 font-medium'}>
                ${capitalPerGrid.toFixed(2)} {capitalPerGrid < 21 ? '⚠ below $21 min' : '✓'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Spacing</span>
              <span>
                ${((parseFloat(upperPrice || '0') - parseFloat(lowerPrice || '0')) / (parseInt(gridCount || '1') - 1)).toFixed(1)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Range</span>
              <span>${parseFloat(lowerPrice || '0').toFixed(0)} – ${parseFloat(upperPrice || '0').toFixed(0)}</span>
            </div>
          </div>

          {mutation.error && (
            <p className="text-red-400 text-xs">{(mutation.error as Error).message}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary text-secondary-foreground px-4 py-2 rounded-md text-sm hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || capitalPerGrid < 21}
              className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending ? 'Updating…' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
