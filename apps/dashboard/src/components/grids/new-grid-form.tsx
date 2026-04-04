'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { X } from 'lucide-react';
import type { GridConfig } from '@grvt-grid-bot/shared';

const INSTRUMENTS = [
  'BTC_USDT_Perp',
  'ETH_USDT_Perp',
  'SOL_USDT_Perp',
  'ARB_USDT_Perp',
];

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function NewGridForm({ onClose, onCreated }: Props) {
  const [form, setForm] = useState<GridConfig>({
    instrument: 'BTC_USDT_Perp',
    upperPrice: 0,
    lowerPrice: 0,
    gridCount: 20,
    gridType: 'arithmetic',
    leverage: 2,
    investmentAmount: 100,
    stopLoss: undefined,
    takeProfit: undefined,
  });

  const createMutation = useMutation({
    mutationFn: (config: GridConfig) => api.grids.create(config),
    onSuccess: onCreated,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate(form);
  }

  function setField<K extends keyof GridConfig>(key: K, value: GridConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg w-full max-w-lg p-6 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Grid</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Instrument */}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">Instrument</label>
            <select
              value={form.instrument}
              onChange={(e) => setField('instrument', e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
            >
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          {/* Price range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Lower Price (USDT)</label>
              <input
                type="number"
                value={form.lowerPrice || ''}
                onChange={(e) => setField('lowerPrice', parseFloat(e.target.value))}
                placeholder="e.g. 90000"
                required
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Upper Price (USDT)</label>
              <input
                type="number"
                value={form.upperPrice || ''}
                onChange={(e) => setField('upperPrice', parseFloat(e.target.value))}
                placeholder="e.g. 110000"
                required
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Grid count + type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Number of Grids</label>
              <input
                type="number"
                value={form.gridCount}
                min={2}
                max={200}
                onChange={(e) => setField('gridCount', parseInt(e.target.value))}
                required
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Grid Type</label>
              <select
                value={form.gridType}
                onChange={(e) => setField('gridType', e.target.value as GridConfig['gridType'])}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="arithmetic">Arithmetic</option>
                <option value="geometric">Geometric</option>
              </select>
            </div>
          </div>

          {/* Leverage + investment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Leverage ({form.leverage}x)
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={form.leverage}
                onChange={(e) => setField('leverage', parseInt(e.target.value))}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Investment (USDT)</label>
              <input
                type="number"
                value={form.investmentAmount}
                min={10}
                onChange={(e) => setField('investmentAmount', parseFloat(e.target.value))}
                required
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Stop loss + take profit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Stop Loss (optional)
              </label>
              <input
                type="number"
                value={form.stopLoss ?? ''}
                onChange={(e) =>
                  setField('stopLoss', e.target.value ? parseFloat(e.target.value) : undefined)
                }
                placeholder="Price"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Take Profit (optional)
              </label>
              <input
                type="number"
                value={form.takeProfit ?? ''}
                onChange={(e) =>
                  setField('takeProfit', e.target.value ? parseFloat(e.target.value) : undefined)
                }
                placeholder="Price"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>

          {createMutation.error && (
            <p className="text-red-400 text-sm">{(createMutation.error as Error).message}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-secondary text-secondary-foreground px-4 py-2 rounded-md text-sm hover:bg-secondary/80"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="flex-1 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Starting…' : 'Start Grid'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
