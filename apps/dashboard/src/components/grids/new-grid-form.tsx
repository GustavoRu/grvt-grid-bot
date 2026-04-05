'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { GridConfig, GridDirection } from '@grvt-grid-bot/shared';

const INSTRUMENTS = [
  'BTC_USDT_Perp',
  'ETH_USDT_Perp',
  'SOL_USDT_Perp',
  'ARB_USDT_Perp',
];

const DIRECTIONS: { value: GridDirection; label: string; description: string; icon: React.ElementType }[] = [
  {
    value: 'long',
    label: 'Long',
    description: 'Buys below market, profits when price rises',
    icon: TrendingUp,
  },
  {
    value: 'short',
    label: 'Short',
    description: 'Sells above market, profits when price falls',
    icon: TrendingDown,
  },
  {
    value: 'neutral',
    label: 'Neutral',
    description: 'Both sides — profits from price oscillation',
    icon: Minus,
  },
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
    direction: 'long',
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
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">New Grid</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
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

          {/* Direction */}
          <div>
            <label className="block text-sm text-muted-foreground mb-2">Direction</label>
            <div className="grid grid-cols-3 gap-2">
              {DIRECTIONS.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setField('direction', value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-md border text-xs transition-colors ${
                    form.direction === value
                      ? value === 'long'
                        ? 'border-green-500 bg-green-500/10 text-green-400'
                        : value === 'short'
                          ? 'border-red-500 bg-red-500/10 text-red-400'
                          : 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-border text-muted-foreground hover:border-border/80'
                  }`}
                  title={description}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{label}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {DIRECTIONS.find((d) => d.value === form.direction)?.description}
            </p>
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
              <label className="block text-sm text-muted-foreground mb-1">Spacing</label>
              <select
                value={form.gridType}
                onChange={(e) => setField('gridType', e.target.value as GridConfig['gridType'])}
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="arithmetic">Arithmetic (equal $)</option>
                <option value="geometric">Geometric (equal %)</option>
              </select>
            </div>
          </div>

          {/* Leverage + investment */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Leverage <span className="text-foreground font-medium">{form.leverage}x</span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                value={form.leverage}
                onChange={(e) => setField('leverage', parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                <span>1x</span><span>20x</span>
              </div>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-1">Investment (USDT)</label>
              <input
                type="number"
                value={form.investmentAmount}
                min={1}
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
                Stop Loss <span className="text-xs">(optional)</span>
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
                Take Profit <span className="text-xs">(optional)</span>
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
