import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { createItemWithPhotos } from "@/lib/items";

export const runtime = "nodejs";
export const maxDuration = 300;

// Phase 1: photos post through the app. Phase 2 switches to presigned
// direct-to-storage uploads for large batches.
export const POST = handle(async (req: Request) => {
  const form = await req.formData();
  const files = form.getAll("photos").filter((v): v is File => v instanceof File);
  const id = await createItemWithPhotos(files);
  return NextResponse.json({ id });
});
