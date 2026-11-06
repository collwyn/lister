import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { draftItem } from "@/lib/drafting/draft";
import { draftEditSchema, saveDraftEdits } from "@/lib/items";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const redraftSchema = z.object({
  tested: z.enum(["works", "not_working", "untested"]).nullable().optional(),
  notesToAi: z.string().max(1000).nullable().optional(),
  /** Keep this condition (picked on the review screen) in the new draft. */
  conditionId: z.string().max(20).nullable().optional(),
});

// Ask Claude for a (new) draft. Optional note and testing status steer it.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const text = await req.text();
  const body = redraftSchema.parse(text ? JSON.parse(text) : {});
  const { conditionId, ...itemFields } = body;
  if (itemFields.tested !== undefined || itemFields.notesToAi !== undefined) {
    await db().update(schema.items).set(itemFields).where(eq(schema.items.id, id));
  }
  await draftItem(id, { conditionId });
  return NextResponse.json({ ok: true });
});

// Save your edits as a new draft version.
export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const draft = await saveDraftEdits(id, draftEditSchema.parse(await req.json()));
  return NextResponse.json({ draft });
});
