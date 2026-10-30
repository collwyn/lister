import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { db, schema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  status: z.enum(["needs_review", "held", "rejected"]).optional(),
  tested: z.enum(["works", "not_working", "untested"]).nullable().optional(),
  notesToAi: z.string().max(1000).nullable().optional(),
});

// Hold, reject, or record testing status / notes for the next redraft.
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = patchSchema.parse(await req.json());
  const [row] = await db().update(schema.items).set(body).where(eq(schema.items.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Item not found." }, { status: 404 });
  return NextResponse.json({ item: row });
});
