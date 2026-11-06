import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { saveGroupEdits } from "@/lib/uploads";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const ids = z.array(z.string().min(1).max(64)).max(2000);
const body = z.object({
  groups: z.array(z.object({ photoIds: ids.min(1, "An item has no photos.") })).max(1000),
  dividers: ids,
  excluded: ids,
  confirm: z.boolean().default(false),
});

// Saves the groups as edited on the grouping screen; confirm starts background drafting.
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await saveGroupEdits(id, body.parse(await req.json()));
  return NextResponse.json({ ok: true });
});
