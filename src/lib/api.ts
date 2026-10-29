import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotConnectedError } from "@/lib/ebay/auth";
import { EbayError } from "@/lib/ebay/http";
import { ListingValidationError } from "@/lib/ebay/publisher";

/** Wraps a route handler so every failure returns { error } with a readable message. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof ListingValidationError) {
    return NextResponse.json({ error: err.message, problems: err.problems }, { status: 422 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: err.issues.map((i) => i.message).join(" ") }, { status: 400 });
  }
  if (err instanceof NotConnectedError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof EbayError) {
    return NextResponse.json({ error: `eBay: ${err.message}`, ebay: err.errors }, { status: 502 });
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}
