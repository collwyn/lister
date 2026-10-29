import { notFound } from "next/navigation";
import { loadItem } from "@/lib/items";
import { getAccount } from "@/lib/ebay/auth";
import { DraftEditor } from "@/components/DraftEditor";

export const dynamic = "force-dynamic";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string }>;
}) {
  const { id } = await params;
  const { draft: autoDraft } = await searchParams;
  const loaded = await loadItem(id);
  if (!loaded) notFound();
  const account = await getAccount().catch(() => null);

  // Plain JSON for the client component (numerics arrive as strings from Postgres).
  const data = JSON.parse(JSON.stringify(loaded)) as typeof loaded;
  return (
    <main className="wrap">
      <DraftEditor
        initial={data}
        autoDraft={autoDraft === "1" && !loaded.draft && loaded.item.status === "grouped"}
        defaultShippingPolicyId={account?.defaultShippingPolicyId ?? null}
        ebayConnected={!!account?.refreshTokenEnc}
      />
    </main>
  );
}
