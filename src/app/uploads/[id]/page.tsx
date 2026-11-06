import { notFound } from "next/navigation";
import { loadUpload, UploadStateError } from "@/lib/uploads";
import { BatchView } from "@/components/BatchView";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadUpload(id).catch((err) => {
    if (err instanceof UploadStateError) return null;
    throw err;
  });
  if (!data) notFound();
  return (
    <main className="wrap">
      <BatchView
        id={id}
        initial={{
          status: data.upload.status,
          groupingError: data.upload.groupingError,
          createdAt: data.upload.createdAt.toISOString(),
          photos: data.photos,
          groups: data.groups,
        }}
      />
    </main>
  );
}
