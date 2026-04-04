import type { GridConfig, Grid, GridOrder, PnlSnapshot } from '@grvt-grid-bot/shared';

const BOT_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BOT_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  grids: {
    list: () => request<Grid[]>('/grids'),
    get: (id: string) => request<Grid>(`/grids/${id}`),
    create: (config: GridConfig) =>
      request<Grid>('/grids', { method: 'POST', body: JSON.stringify(config) }),
    stop: (id: string) => request<{ success: boolean }>(`/grids/${id}/stop`, { method: 'POST' }),
    orders: (id: string) => request<GridOrder[]>(`/grids/${id}/orders`),
    pnl: (id: string) => request<PnlSnapshot[]>(`/grids/${id}/pnl`),
  },
};

// Re-export shared types for convenience
export type { GridConfig, Grid, GridOrder, PnlSnapshot };
