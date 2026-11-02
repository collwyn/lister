import { MOCK_CATEGORIES } from "./mock";

// Test mode (EBAY_ENV=mock) stand-in for the Trading API calls the app makes.
// Checks a listing the way eBay does and answers in eBay's XML format.
// Nothing is sent to eBay.

const created = new Map<string, string>(); // UUID -> ItemID

const tagValue = (xml: string, name: string) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];

function respond(call: string, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><${call}Response xmlns="urn:ebay:apis:eBLBaseComponents"><Timestamp>${new Date().toISOString()}</Timestamp>${body}<Version>1451</Version></${call}Response>`;
}

function failure(call: string, errors: { code: number; message: string }[], extra = "") {
  const list = errors
    .map(
      (e) =>
        `<Errors><ShortMessage>${e.message} (test mode)</ShortMessage><LongMessage>${e.message} (test mode)</LongMessage><ErrorCode>${e.code}</ErrorCode><SeverityCode>Error</SeverityCode></Errors>`,
    )
    .join("");
  return respond(call, `<Ack>Failure</Ack>${list}${extra}`);
}

export async function mockTrading(callName: string, xml: string): Promise<string> {
  if (callName !== "AddFixedPriceItem" && callName !== "VerifyAddFixedPriceItem") {
    return failure(callName, [{ code: 2, message: `Test mode doesn't handle ${callName}` }]);
  }
  const item = tagValue(xml, "Item") ?? "";
  const uuid = tagValue(item, "UUID");

  if (callName === "AddFixedPriceItem" && uuid && created.has(uuid)) {
    return failure(
      callName,
      [{ code: 488, message: "Duplicate UUID used." }],
      `<DuplicateInvocationDetails><DuplicateInvocationID>${uuid}</DuplicateInvocationID><Status>Success</Status><InvocationTrackingID>${created.get(uuid)}</InvocationTrackingID></DuplicateInvocationDetails>`,
    );
  }

  const problems: { code: number; message: string }[] = [];
  const category = MOCK_CATEGORIES.find((c) => c.id === tagValue(item, "CategoryID"));
  if (!category) problems.push({ code: 87, message: "The category selected is not a leaf category." });

  const specifics = new Set([...item.matchAll(/<NameValueList><Name>([^<]*)<\/Name>(?:<Value>[^<]*<\/Value>)+/g)].map((m) => m[1]));
  const missing = category?.aspects.filter((a) => a.required && !specifics.has(a.name)).map((a) => a.name) ?? [];
  if (missing.length) problems.push({ code: 21919303, message: `The item specific ${missing.join(", ")} is missing.` });

  const conditionId = tagValue(item, "ConditionID");
  if (category && (!conditionId || !category.conditions.includes(conditionId))) {
    problems.push({ code: 21917121, message: "The item condition is not valid for this category." });
  }
  if (!/<PictureURL>/.test(item)) problems.push({ code: 21919136, message: "At least one photo is required." });
  if (!tagValue(item, "PostalCode")) problems.push({ code: 10019, message: "A postal code is required." });
  if (!/<PaymentProfileID>[^<]+</.test(item) || !/<ShippingProfileID>[^<]+</.test(item)) {
    problems.push({ code: 21916250, message: "Business policies are required." });
  }

  if (problems.length) return failure(callName, problems);

  const fees = `<Fees><Fee><Name>InsertionFee</Name><Fee currencyID="USD">0.0</Fee></Fee></Fees>`;
  if (callName === "VerifyAddFixedPriceItem") return respond(callName, `<Ack>Success</Ack>${fees}`);

  const itemId = `11${Date.now().toString().slice(-10)}`;
  if (uuid) created.set(uuid, itemId);
  return respond(callName, `<Ack>Success</Ack><ItemID>${itemId}</ItemID>${fees}`);
}
