import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { createLocation } from "@/lib/ebay/account";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().min(1).max(100).default("Home"),
  city: z.string().min(1, "Enter a city."),
  stateOrProvince: z.string().length(2, "Use the two-letter state code."),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code."),
});

export const POST = handle(async (req: Request) => {
  const key = await createLocation(schema.parse(await req.json()));
  return NextResponse.json({ locationKey: key });
});
