import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFixedPriceItemXml, listingUuid, parseTradingResponse, splitWeight } from "@/lib/ebay/trading-xml";
import type { ListingInput } from "@/lib/ebay/listing";

const base: ListingInput = {
  sku: "item-1",
  title: "Epiphone Les Paul Special Electric Guitar Cherry & Case",
  description: "Solid-body electric guitar.\n\n- Plays well\n- Light wear <see photos>",
  categoryId: "33034",
  conditionId: "3000",
  conditionNotes: "Light scratches on the lower bout.",
  aspects: { Brand: ["Epiphone"], Model: ["Les Paul Special"], Features: ["Bolt-on neck", "P-90 pickups"] },
  price: 179,
  quantity: 1,
  imageUrls: ["https://photos.example/p/1.jpg", "https://photos.example/p/2.jpg"],
  weightOz: 240,
  dims: { lengthIn: 44, widthIn: 16, heightIn: 5.5 },
  marketplaceId: "EBAY_US",
  policies: { paymentPolicyId: "111", returnPolicyId: "222", fulfillmentPolicyId: "333" },
  merchantLocationKey: "",
  shipFrom: { postalCode: "11201", city: "Brooklyn", stateOrProvince: "NY" },
};

describe("AddFixedPriceItem request", () => {
  const xml = addFixedPriceItemXml(base);

  it("is an AddFixedPriceItem request in eBay's namespace", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><AddFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">')).toBe(true);
    expect(xml.endsWith("</AddFixedPriceItemRequest>")).toBe(true);
    expect(addFixedPriceItemXml(base, { verify: true })).toContain("<VerifyAddFixedPriceItemRequest ");
  });

  it("escapes text and puts the HTML description in CDATA", () => {
    expect(xml).toContain("<Title>Epiphone Les Paul Special Electric Guitar Cherry &amp; Case</Title>");
    expect(xml).toContain("<Description><![CDATA[<p>Solid-body electric guitar.</p>");
    expect(xml).toContain("Light wear &lt;see photos&gt;</li>");
  });

  it("carries category, condition, specifics, price and quantity", () => {
    expect(xml).toContain("<PrimaryCategory><CategoryID>33034</CategoryID></PrimaryCategory>");
    expect(xml).toContain("<ConditionID>3000</ConditionID>");
    expect(xml).toContain("<ConditionDescription>Light scratches on the lower bout.</ConditionDescription>");
    expect(xml).toContain("<NameValueList><Name>Features</Name><Value>Bolt-on neck</Value><Value>P-90 pickups</Value></NameValueList>");
    expect(xml).toContain('<StartPrice currencyID="USD">179.00</StartPrice>');
    expect(xml).toContain("<Quantity>1</Quantity>");
    expect(xml).toContain("<ListingDuration>GTC</ListingDuration><ListingType>FixedPriceItem</ListingType>");
  });

  it("carries the ship-from address, photos, SKU and business policies", () => {
    expect(xml).toContain("<Country>US</Country><PostalCode>11201</PostalCode><Location>Brooklyn, NY</Location>");
    expect(xml).toContain("<PictureDetails><PictureURL>https://photos.example/p/1.jpg</PictureURL><PictureURL>https://photos.example/p/2.jpg</PictureURL></PictureDetails>");
    expect(xml).toContain("<SKU>item-1</SKU>");
    expect(xml).toContain("<PaymentProfileID>111</PaymentProfileID>");
    expect(xml).toContain("<ReturnProfileID>222</ReturnProfileID>");
    expect(xml).toContain("<ShippingProfileID>333</ShippingProfileID>");
  });

  it("sends weight in lbs/oz and box size in whole inches", () => {
    expect(xml).toContain('<PackageDepth unit="in" measurementSystem="English">6</PackageDepth>');
    expect(xml).toContain('<PackageLength unit="in" measurementSystem="English">44</PackageLength>');
    expect(xml).toContain('<WeightMajor unit="lbs" measurementSystem="English">15</WeightMajor>');
    expect(xml).toContain('<WeightMinor unit="oz" measurementSystem="English">0</WeightMinor>');
  });

  it("leaves out condition notes for new items and package details when unknown", () => {
    const x = addFixedPriceItemXml({ ...base, conditionId: "1000", weightOz: null, dims: null });
    expect(x).not.toContain("<ConditionDescription>");
    expect(x).not.toContain("<ShippingPackageDetails>");
  });

  it("can't be broken out of CDATA by the description", () => {
    const x = addFixedPriceItemXml({ ...base, description: "a ]]> b" });
    // The HTML escaping turns ">" into "&gt;" before it reaches the CDATA block.
    expect(x).toContain("<Description><![CDATA[<p>a ]]&gt; b</p>]]></Description>");
  });
});

describe("helpers", () => {
  it("splits ounces into pounds and ounces, rounding up", () => {
    expect(splitWeight(240)).toEqual({ lbs: 15, oz: 0 });
    expect(splitWeight(17.2)).toEqual({ lbs: 1, oz: 2 });
    expect(splitWeight(15.5)).toEqual({ lbs: 1, oz: 0 });
  });

  it("makes a 32-character duplicate-guard ID that changes only when the listing does", () => {
    const id = listingUuid(base);
    expect(id).toMatch(/^[0-9A-F]{32}$/);
    expect(listingUuid({ ...base })).toBe(id);
    expect(listingUuid({ ...base, price: 169 })).not.toBe(id);
    expect(listingUuid({ ...base, shipFrom: { postalCode: "10001" } })).toBe(id);
    // A deliberate relist of the same item must not look like a repeat of the first request.
    expect(listingUuid({ ...base, relist: 1 })).not.toBe(id);
  });
});

describe("parsing eBay's answers", () => {
  it("reads a success with the item number and insertion fee", () => {
    const r = parseTradingResponse(
      '<AddFixedPriceItemResponse><Ack>Success</Ack><ItemID>110012345678</ItemID><Fees><Fee><Name>AuctionLengthFee</Name><Fee currencyID="USD">0.0</Fee></Fee><Fee><Name>InsertionFee</Name><Fee currencyID="USD">0.35</Fee></Fee></Fees></AddFixedPriceItemResponse>',
    );
    expect(r).toMatchObject({ ack: "Success", itemId: "110012345678", errors: [], insertionFee: 0.35 });
  });

  it("separates errors from warnings", () => {
    const r = parseTradingResponse(
      "<R><Ack>Failure</Ack><Errors><ShortMessage>Bad &amp; wrong</ShortMessage><LongMessage>The item specific Brand is missing.</LongMessage><ErrorCode>21919303</ErrorCode><SeverityCode>Error</SeverityCode></Errors><Errors><ShortMessage>FYI</ShortMessage><LongMessage>Consider adding more photos.</LongMessage><ErrorCode>1</ErrorCode><SeverityCode>Warning</SeverityCode></Errors></R>",
    );
    expect(r.errors).toEqual([{ errorId: 21919303, message: "Bad & wrong", longMessage: "The item specific Brand is missing.", severity: "Error" }]);
    expect(r.warnings.map((w) => w.longMessage)).toEqual(["Consider adding more photos."]);
  });

  it("reads the original item number from a duplicate-request answer", () => {
    const r = parseTradingResponse(
      "<R><Ack>Failure</Ack><Errors><ShortMessage>Duplicate UUID</ShortMessage><ErrorCode>488</ErrorCode><SeverityCode>Error</SeverityCode></Errors><DuplicateInvocationDetails><DuplicateInvocationID>ABC</DuplicateInvocationID><Status>Success</Status><InvocationTrackingID>110099</InvocationTrackingID></DuplicateInvocationDetails></R>",
    );
    expect(r.duplicateItemId).toBe("110099");
  });
});

describe("publishing through the Trading API (test mode)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/ebay/auth", () => ({ userToken: async () => "user-token" }));
    Object.assign(process.env, {
      APP_BASE_URL: "https://lister.example",
      ADMIN_PASSWORD_HASH: "$2b$12$" + "x".repeat(53),
      SESSION_SECRET: "s".repeat(44),
      ENCRYPTION_KEY: "k".repeat(44),
      DATABASE_URL: "postgres://x",
      S3_ENDPOINT: "https://s3.example",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "b",
      S3_BUCKET_ORIGINALS: "o",
      S3_BUCKET_PUBLIC: "p",
      PUBLIC_PHOTO_BASE_URL: "https://p.example",
      ANTHROPIC_API_KEY: "x",
      EBAY_ENV: "mock",
    });
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const mockListing = (over: Partial<ListingInput> = {}): ListingInput => ({
    ...base,
    sku: `sku-${Math.random().toString(36).slice(2)}`,
    categoryId: "mock-headphones",
    aspects: { Brand: ["Sony"], Type: ["Ear-Cup (Over the Ear)"] },
    ...over,
  });

  it("is the default publisher", async () => {
    const { getPublisher } = await import("@/lib/ebay/publisher");
    expect(getPublisher().name).toBe("trading-api");
  });

  it("publishes and returns the new item number", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    const res = await new TradingApiPublisher().publish(mockListing());
    expect(res.listingId).toMatch(/^11\d{10}$/);
  });

  it("returns the same listing when the identical request is sent twice", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    const listing = mockListing();
    const first = await new TradingApiPublisher().publish(listing);
    const again = await new TradingApiPublisher().publish(listing);
    expect(again.listingId).toBe(first.listingId);
  });

  it("passes eBay-style rejections through with eBay's message", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    await expect(new TradingApiPublisher().publish(mockListing({ aspects: { Brand: ["Sony"] } }))).rejects.toThrow(/item specific Type is missing/);
  });

  it("asks for the ZIP before calling eBay when it's missing", async () => {
    const { TradingApiPublisher, ListingValidationError } = await import("@/lib/ebay/publisher");
    await expect(new TradingApiPublisher().publish(mockListing({ shipFrom: null }))).rejects.toBeInstanceOf(ListingValidationError);
  });

  it("runs eBay's dry run without listing anything", async () => {
    const { TradingApiPublisher } = await import("@/lib/ebay/publisher");
    const listing = mockListing();
    const v = await new TradingApiPublisher().verify(listing);
    expect(v.insertionFee).toBe(0);
    const res = await new TradingApiPublisher().publish(listing);
    expect(res.listingId).toBeTruthy();
  });
});
