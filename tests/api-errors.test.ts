import { afterEach, describe, expect, it, vi } from "vitest";
import { errorResponse } from "@/lib/api";
import { EbayError } from "@/lib/ebay/http";
import { api } from "@/lib/client-api";

describe("server error responses", () => {
  it("never uses gateway status codes for eBay errors (Sevalla's edge would hide the message)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = errorResponse(new EbayError(400, [{ errorId: 20403, message: "Invalid user." }], "x"));
    expect([502, 503, 504]).not.toContain(res.status);
    expect(await res.json()).toMatchObject({ error: "eBay: Invalid user." });
  });
});

describe("browser api helper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the app's own error message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "eBay: Invalid user." }), { status: 422 }));
    await expect(api("/x")).rejects.toThrow("eBay: Invalid user.");
  });

  it("explains a response with no readable body", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api("/x")).rejects.toThrow(/didn't return a readable answer \(status 502\).*runtime logs in Sevalla/);
  });
});
