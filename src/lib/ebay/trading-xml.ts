import { createHash } from "node:crypto";
import type { EbayErrorItem } from "./errors";
import { allowsConditionNotes } from "./conditions";
import { cleanAspects, descriptionHtml, TITLE_MAX, type ListingInput } from "./listing";

// Pure builders/parsers for eBay's Trading API (XML). Listings created this way
// are ordinary listings that Seller Hub can edit, unlike Inventory API ones.
// Reference: AddFixedPriceItem / VerifyAddFixedPriceItem in the Trading API docs.

const NS = "urn:ebay:apis:eBLBaseComponents";

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const unescapeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** HTML inside CDATA; a literal "]]>" in the text is split so it can't end the section early. */
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

const el = (name: string, value: string | number, attrs = "") => `<${name}${attrs}>${escapeXml(String(value))}</${name}>`;

/**
 * eBay's duplicate guard: 32 hex characters. Derived from the listing's content,
 * so resending the same listing (a double click, a timeout) can't create a second
 * one, while an edited draft gets a new ID.
 */
export function listingUuid(input: ListingInput): string {
  const { shipFrom, merchantLocationKey, ...content } = input;
  void shipFrom;
  void merchantLocationKey;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 32).toUpperCase();
}

/** Ounces to eBay's pounds + ounces, rounded up to a whole ounce. */
export function splitWeight(weightOz: number): { lbs: number; oz: number } {
  const total = Math.ceil(weightOz);
  return { lbs: Math.floor(total / 16), oz: total % 16 };
}

export function addFixedPriceItemXml(input: ListingInput, opts: { verify?: boolean } = {}): string {
  const call = opts.verify ? "VerifyAddFixedPriceItemRequest" : "AddFixedPriceItemRequest";
  const aspects = cleanAspects(input.aspects);
  const parts: string[] = [];

  parts.push(el("Title", input.title.trim().slice(0, TITLE_MAX)));
  parts.push(`<Description>${cdata(descriptionHtml(input.description))}</Description>`);
  parts.push(`<PrimaryCategory>${el("CategoryID", input.categoryId)}</PrimaryCategory>`);
  parts.push(el("ConditionID", input.conditionId));
  if (input.conditionNotes?.trim() && allowsConditionNotes(input.conditionId)) {
    parts.push(el("ConditionDescription", input.conditionNotes.trim().slice(0, 1000)));
  }
  const specifics = Object.entries(aspects)
    .map(([name, values]) => `<NameValueList>${el("Name", name)}${values.map((v) => el("Value", v)).join("")}</NameValueList>`)
    .join("");
  if (specifics) parts.push(`<ItemSpecifics>${specifics}</ItemSpecifics>`);

  const currency = input.currency ?? "USD";
  parts.push(el("StartPrice", input.price.toFixed(2), ` currencyID="${currency}"`));
  parts.push(el("Quantity", input.quantity));
  parts.push(el("Currency", currency));
  parts.push(el("Country", "US"));
  if (input.shipFrom?.postalCode) parts.push(el("PostalCode", input.shipFrom.postalCode));
  const place = [input.shipFrom?.city, input.shipFrom?.stateOrProvince].filter(Boolean).join(", ");
  if (place) parts.push(el("Location", place));
  parts.push(el("ListingDuration", "GTC"));
  parts.push(el("ListingType", "FixedPriceItem"));
  parts.push(`<PictureDetails>${input.imageUrls.slice(0, 24).map((u) => el("PictureURL", u)).join("")}</PictureDetails>`);
  parts.push(el("SKU", input.sku));
  parts.push(el("UUID", listingUuid(input)));
  parts.push(
    "<SellerProfiles>" +
      `<SellerPaymentProfile>${el("PaymentProfileID", input.policies.paymentPolicyId)}</SellerPaymentProfile>` +
      `<SellerReturnProfile>${el("ReturnProfileID", input.policies.returnPolicyId)}</SellerReturnProfile>` +
      `<SellerShippingProfile>${el("ShippingProfileID", input.policies.fulfillmentPolicyId)}</SellerShippingProfile>` +
      "</SellerProfiles>",
  );

  if (input.weightOz || input.dims) {
    const english = ` measurementSystem="English"`;
    const pkg: string[] = [el("MeasurementUnit", "English")];
    if (input.dims) {
      // English measurements must be whole inches.
      pkg.push(el("PackageDepth", Math.ceil(input.dims.heightIn), ` unit="in"${english}`));
      pkg.push(el("PackageLength", Math.ceil(input.dims.lengthIn), ` unit="in"${english}`));
      pkg.push(el("PackageWidth", Math.ceil(input.dims.widthIn), ` unit="in"${english}`));
    }
    if (input.weightOz) {
      const w = splitWeight(input.weightOz);
      pkg.push(el("WeightMajor", w.lbs, ` unit="lbs"${english}`));
      pkg.push(el("WeightMinor", w.oz, ` unit="oz"${english}`));
    }
    parts.push(`<ShippingPackageDetails>${pkg.join("")}</ShippingPackageDetails>`);
  }

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<${call} xmlns="${NS}">` +
    "<ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>" +
    `<Item>${parts.join("")}</Item>` +
    `</${call}>`
  );
}

export type TradingError = EbayErrorItem & { severity: "Error" | "Warning" | string };

export type TradingResult = {
  ack: "Success" | "Warning" | "Failure" | "PartialFailure" | string;
  itemId?: string;
  errors: TradingError[]; // severity Error
  warnings: TradingError[]; // severity Warning
  /** When eBay recognises a resent UUID: the ItemID the first request created. */
  duplicateItemId?: string;
  insertionFee?: number;
};

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? unescapeXml(m[1].trim()) : undefined;
}

/** Reads the parts of an Add/VerifyAddFixedPriceItem response the app uses. */
export function parseTradingResponse(xml: string): TradingResult {
  const all = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map((m): TradingError => {
    const code = tag(m[1], "ErrorCode");
    return {
      errorId: code ? Number(code) : undefined,
      message: tag(m[1], "ShortMessage"),
      longMessage: tag(m[1], "LongMessage"),
      severity: tag(m[1], "SeverityCode") ?? "Error",
    };
  });

  let insertionFee: number | undefined;
  for (const m of xml.matchAll(/<Fee>\s*<Name>([^<]+)<\/Name>\s*<Fee[^>]*>([^<]+)<\/Fee>/g)) {
    if (m[1] === "InsertionFee") insertionFee = Number(m[2]);
  }

  const dup = /<DuplicateInvocationDetails>([\s\S]*?)<\/DuplicateInvocationDetails>/.exec(xml)?.[1];
  return {
    ack: tag(xml, "Ack") ?? "Failure",
    itemId: tag(xml, "ItemID"),
    errors: all.filter((e) => e.severity === "Error"),
    warnings: all.filter((e) => e.severity !== "Error"),
    duplicateItemId: dup ? tag(dup, "InvocationTrackingID") : undefined,
    insertionFee,
  };
}
