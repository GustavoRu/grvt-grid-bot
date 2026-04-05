import { GridDetailPage } from '@/components/grid-detail/grid-detail-page';

export default function Page({ params }: { params: { id: string } }) {
  return <GridDetailPage id={params.id} />;
}
