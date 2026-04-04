import { Suspense } from 'react';
import { GridsPage } from '@/components/grids/grids-page';

export default function GridsRoute() {
  return (
    <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
      <GridsPage />
    </Suspense>
  );
}
