import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { userToken } from "./auth";
import { EbayError, ebayFetch } from "./http";

// Business policies (payment, returns, shipping) and the ship-from location.
// The Inventory API requires both on every listing.

export type Policy = { id: string; name: string; description?: string };

export async function listPolicies(): Promise<{ payment: Policy[]; returns: Policy[]; shipping: Policy[] }> {
  const token = await userToken();
  const query = { marketplace_id: env().EBAY_MARKETPLACE_ID };
  const [p, r, f] = await Promise.all([
    ebayFetch<{ paymentPolicies?: { paymentPolicyId: string; name: string; description?: string }[] }>(
      "/sell/account/v1/payment_policy",
      token,
      { query },
    ),
    ebayFetch<{ returnPolicies?: { returnPolicyId: string; name: string; description?: string }[] }>(
      "/sell/account/v1/return_policy",
      token,
      { query },
    ),
    ebayFetch<{ fulfillmentPolicies?: { fulfillmentPolicyId: string; name: string; description?: string }[] }>(
      "/sell/account/v1/fulfillment_policy",
      token,
      { query },
    ),
  ]);
  return {
    payment: (p.paymentPolicies ?? []).map((x) => ({ id: x.paymentPolicyId, name: x.name, description: x.description })),
    returns: (r.returnPolicies ?? []).map((x) => ({ id: x.returnPolicyId, name: x.name, description: x.description })),
    shipping: (f.fulfillmentPolicies ?? []).map((x) => ({
      id: x.fulfillmentPolicyId,
      name: x.name,
      description: x.description,
    })),
  };
}

export async function optInToBusinessPolicies(): Promise<"opted_in" | "already"> {
  try {
    await ebayFetch("/sell/account/v1/program/opt_in", await userToken(), {
      method: "POST",
      body: { programType: "SELLING_POLICY_MANAGEMENT" },
    });
    return "opted_in";
  } catch (err) {
    // 20403 / 25803-style "already opted in" responses are fine.
    if (err instanceof EbayError && /already/i.test(err.message)) return "already";
    throw err;
  }
}

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: false }];

/**
 * Sandbox helper: creates one payment, one return and one shipping policy so you can
 * test publishing before setting up real policies. In production, create your
 * policies in Seller Hub instead and pick them in Settings.
 */
export async function createStarterPolicies() {
  if (env().EBAY_ENV !== "sandbox") throw new Error("Starter policies are for the sandbox only.");
  const token = await userToken();
  const marketplaceId = env().EBAY_MARKETPLACE_ID;
  const stamp = new Date().toISOString().slice(0, 10);

  const payment = await ebayFetch<{ paymentPolicyId: string }>("/sell/account/v1/payment_policy", token, {
    method: "POST",
    body: { name: `Listing Desk payment ${stamp}`, marketplaceId, categoryTypes: CATEGORY_TYPES, immediatePay: true },
  });
  const returns = await ebayFetch<{ returnPolicyId: string }>("/sell/account/v1/return_policy", token, {
    method: "POST",
    body: {
      name: `Listing Desk 30-day returns ${stamp}`,
      marketplaceId,
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
      refundMethod: "MONEY_BACK",
    },
  });
  const shipping = await ebayFetch<{ fulfillmentPolicyId: string }>("/sell/account/v1/fulfillment_policy", token, {
    method: "POST",
    body: {
      name: `Listing Desk USPS Priority ${stamp}`,
      marketplaceId,
      categoryTypes: CATEGORY_TYPES,
      handlingTime: { value: 2, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingCarrierCode: "USPS",
              shippingServiceCode: "USPSPriority",
              shippingCost: { value: "10.00", currency: "USD" },
            },
          ],
        },
      ],
    },
  });

  await saveSettings({
    paymentPolicyId: payment.paymentPolicyId,
    returnPolicyId: returns.returnPolicyId,
    defaultShippingPolicyId: shipping.fulfillmentPolicyId,
  });
}

export type LocationInput = { name: string; city: string; stateOrProvince: string; postalCode: string };

export async function createLocation(input: LocationInput): Promise<string> {
  const key = "home";
  try {
    await ebayFetch(`/sell/inventory/v1/location/${key}`, await userToken(), {
      method: "POST",
      body: {
        name: input.name,
        location: {
          address: {
            city: input.city,
            stateOrProvince: input.stateOrProvince,
            postalCode: input.postalCode,
            country: "US",
          },
        },
        locationTypes: ["WAREHOUSE"],
        merchantLocationStatus: "ENABLED",
      },
    });
  } catch (err) {
    // 25803: location already exists. Reuse it.
    if (!(err instanceof EbayError && (err.hasErrorId(25803) || /already exists/i.test(err.message)))) throw err;
  }
  await saveSettings({ locationKey: key });
  return key;
}

export async function saveSettings(values: {
  paymentPolicyId?: string | null;
  returnPolicyId?: string | null;
  defaultShippingPolicyId?: string | null;
  locationKey?: string | null;
}) {
  const environment = env().EBAY_ENV;
  const existing = await db().select().from(schema.ebayAccount).where(eq(schema.ebayAccount.environment, environment));
  if (existing.length) {
    await db().update(schema.ebayAccount).set(values).where(eq(schema.ebayAccount.environment, environment));
  } else {
    await db().insert(schema.ebayAccount).values({ environment, ...values });
  }
}
