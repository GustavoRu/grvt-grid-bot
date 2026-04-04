import { Suspense } from 'react';
import { DashboardHome } from '@/components/dashboard/dashboard-home';

export default function HomePage() {
  return (
    <Suspense fallback={<div className="text-muted-foreground">Loading…</div>}>
      <DashboardHome />
    </Suspense>
  );
}
