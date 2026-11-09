import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
import { choosePaymentPolicy, isPickupOnly, PickupPaymentError } from "@/lib/ebay/account";
import { EbayError } from "@/lib/ebay/errors";

const policies: Record<string, unknown> = {
  "/sell/account/v1/fulfillment_policy/ship": { localPickup: false, shippingOptions: [{ shippingServices: [{ shippingServiceCode: "UPSGround" }] }] },
  "/sell/account/v1/fulfillment_policy/ship-or-pickup": { localPickup: true, shippingOptions: [{ shippingServices: [{ shippingServiceCode: "UPSGround" }] }] },
  "/sell/account/v1/fulfillment_policy/pickup": { localPickup: true, shippingOptions: [] },
  "/sell/account/v1/payment_policy/immediate": { immediatePay: true },
  "/sell/account/v1/payment_policy/later": { immediatePay: false },
};
const fetcher = (async (path: string) => {
  if (path in policies) return policies[path];
  throw new EbayError(404, [{ message: "not found" }], "not found");
}) as never;
const token = async () => "t";
const choose = (shippingPolicyId: string, paymentPolicyId: string, pickupPaymentPolicyId?: string | null) =>
  choosePaymentPolicy({ shippingPolicyId, paymentPolicyId, pickupPaymentPolicyId }, fetcher, token);

describe("local pickup and immediate payment", () => {
  it("treats a policy as pickup-only only when it has no shipping services", () => {
    expect(isPickupOnly({ localPickup: true, shippingOptions: [] })).toBe(true);
    expect(isPickupOnly({ localPickup: true, shippingOptions: [{ shippingServices: [] }] })).toBe(true);
    expect(isPickupOnly({ localPickup: true, shippingOptions: [{ shippingServices: [{}] }] })).toBe(false);
    expect(isPickupOnly({ localPickup: false })).toBe(false);
  });

  it("keeps the default payment policy for items that ship", async () => {
    expect(await choose("ship", "immediate", "later")).toBe("immediate");
    expect(await choose("ship-or-pickup", "immediate", "later")).toBe("immediate");
  });

  it("uses the pickup payment policy for pickup-only items", async () => {
    expect(await choose("pickup", "immediate", "later")).toBe("later");
  });

  it("keeps the default when it doesn't require immediate payment", async () => {
    expect(await choose("pickup", "later", null)).toBe("later");
  });

  it("explains what to set up when nothing allows pickup", async () => {
    await expect(choose("pickup", "immediate", null)).rejects.toBeInstanceOf(PickupPaymentError);
  });

  it("leaves it to eBay when the policies can't be read", async () => {
    expect(await choose("unknown", "immediate", null)).toBe("immediate");
  });
});
