import { describe, expect, it, vi } from "vitest";

// items.ts pulls in storage/eBay modules; only the edit schema is under test.
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));

import { draftEditSchema } from "@/lib/items";

const edit = {
  title: "Epiphone Les Paul Special",
  description: "d",
  categoryId: "33034",
  categoryName: "Electric Guitars",
  conditionId: "3000",
  conditionNotes: null,
  aspects: {},
  price: 179,
  quantity: 1,
  shippingPolicyId: null,
  weightOz: 160,
};

describe("draft edits", () => {
  it("accept a box size", () => {
    expect(draftEditSchema.parse({ ...edit, dims: { lengthIn: 44, widthIn: 16, heightIn: 6 } }).dims).toEqual({ lengthIn: 44, widthIn: 16, heightIn: 6 });
  });
  it("accept clearing it, or leaving it out", () => {
    expect(draftEditSchema.parse({ ...edit, dims: null }).dims).toBeNull();
    expect(draftEditSchema.parse(edit).dims).toBeUndefined();
  });
  it("reject zero or negative measurements", () => {
    expect(() => draftEditSchema.parse({ ...edit, dims: { lengthIn: 0, widthIn: 16, heightIn: 6 } })).toThrow();
  });
});
