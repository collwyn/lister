import { isMockEbay } from "@/lib/env";
import { EbayError } from "./errors";
import { ebayHosts } from "./http";
import { mockTrading } from "./mock-trading";
import { parseTradingResponse, type TradingResult } from "./trading-xml";

// Transport for eBay's Trading API (XML over HTTPS). Uses the same OAuth user
// token as the REST APIs, sent in X-EBAY-API-IAF-TOKEN.

/** A recent Trading API schema version; eBay accepts calls at or below the current release. */
export const TRADING_COMPATIBILITY_LEVEL = "1451";
const SITE_ID_US = "0";

export async function tradingCall(callName: string, xml: string, token: string): Promise<TradingResult> {
  // Test mode: answer locally, like ebayFetch does for the REST APIs.
  const text = isMockEbay() ? await mockTrading(callName, xml) : await post(callName, xml, token);
  const result = { ...parseTradingResponse(text), raw: text };

  // eBay already processed this exact request: treat it as done, with the original listing.
  if (result.duplicateItemId) return { ...result, itemId: result.duplicateItemId, errors: [] };

  if (result.ack === "Failure" || result.ack === "PartialFailure" || (result.errors.length && !result.itemId)) {
    const errors = result.errors.length ? result.errors : [{ message: `eBay returned ${result.ack} for ${callName}.` }];
    throw new EbayError(400, errors, `eBay rejected ${callName}.`);
  }
  return result;
}

async function post(callName: string, xml: string, token: string): Promise<string> {
  const res = await fetch(`${ebayHosts().api}/ws/api.dll`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "Accept-Language": "en-US",
      "X-EBAY-API-CALL-NAME": callName,
      "X-EBAY-API-SITEID": SITE_ID_US,
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPATIBILITY_LEVEL,
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: xml,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok && !text.includes("<Ack>")) {
    throw new EbayError(res.status, [{ message: text.slice(0, 300) || `HTTP ${res.status}` }], `eBay returned ${res.status} for ${callName}.`);
  }
  return text;
}
