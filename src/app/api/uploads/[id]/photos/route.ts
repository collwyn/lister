import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { addPhoto } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

const num = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

// One photo per request, so a batch of hundreds never hits a request-size or time limit.
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "No photo in the request." }, { status: 400 });
  const photo = await addPhoto(id, file, {
    pickOrder: num(form.get("pickOrder")) ?? 0,
    lastModified: num(form.get("lastModified")),
    tzOffsetMinutes: num(form.get("tzOffset")),
  });
  return NextResponse.json({ photo });
});
