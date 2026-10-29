import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { saveSettings } from "@/lib/ebay/account";

export const runtime = "nodejs";

const schema = z.object({
  paymentPolicyId: z.string().min(1).nullable(),
  returnPolicyId: z.string().min(1).nullable(),
  defaultShippingPolicyId: z.string().min(1).nullable(),
});

export const POST = handle(async (req: Request) => {
  await saveSettings(schema.parse(await req.json()));
  return NextResponse.json({ ok: true });
});
