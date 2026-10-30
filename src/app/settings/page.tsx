import { getAccount } from "@/lib/ebay/auth";
import { env } from "@/lib/env";
import { SettingsPanel } from "@/components/SettingsPanel";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; ebay_error?: string }> }) {
  const sp = await searchParams;
  const e = env();
  const account = await getAccount().catch(() => null);
  return (
    <main className="wrap">
      <h1>Settings</h1>
      <SettingsPanel
        environment={e.EBAY_ENV}
        connected={!!account?.refreshTokenEnc}
        refreshExpires={account?.refreshTokenExpires?.toISOString() ?? null}
        saved={{
          paymentPolicyId: account?.paymentPolicyId ?? null,
          returnPolicyId: account?.returnPolicyId ?? null,
          defaultShippingPolicyId: account?.defaultShippingPolicyId ?? null,
          locationKey: account?.locationKey ?? null,
        }}
        deletionEndpoint={`${e.APP_BASE_URL}/api/ebay/account-deletion`}
        callbackUrl={`${e.APP_BASE_URL}/api/ebay/callback`}
        justConnected={sp.connected === "1"}
        connectError={sp.ebay_error ?? null}
      />
    </main>
  );
}
