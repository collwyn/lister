import { describe, expect, it } from "vitest";
import { bucketConfigs } from "@/lib/storage";

const shared = {
  S3_ENDPOINT: "https://shared.example",
  S3_REGION: "auto",
  S3_ACCESS_KEY_ID: "public-key",
  S3_SECRET_ACCESS_KEY: "public-secret",
  S3_ORIGINALS_ENDPOINT: undefined,
  S3_ORIGINALS_ACCESS_KEY_ID: undefined,
  S3_ORIGINALS_SECRET_ACCESS_KEY: undefined,
  S3_BUCKET_ORIGINALS: "photobucket1-originals",
  S3_BUCKET_PUBLIC: "photobucket1",
};

describe("bucketConfigs", () => {
  it("uses the shared keys for both buckets when no overrides are set", () => {
    const c = bucketConfigs(shared);
    expect(c.public).toMatchObject({ bucket: "photobucket1", accessKeyId: "public-key", endpoint: "https://shared.example" });
    expect(c.originals).toMatchObject({ bucket: "photobucket1-originals", accessKeyId: "public-key", endpoint: "https://shared.example" });
  });

  it("gives the originals bucket its own keys and endpoint when set", () => {
    const c = bucketConfigs({
      ...shared,
      S3_ORIGINALS_ENDPOINT: "https://private.example",
      S3_ORIGINALS_ACCESS_KEY_ID: "private-key",
      S3_ORIGINALS_SECRET_ACCESS_KEY: "private-secret",
    });
    expect(c.originals).toMatchObject({ endpoint: "https://private.example", accessKeyId: "private-key", secretAccessKey: "private-secret" });
    expect(c.public).toMatchObject({ endpoint: "https://shared.example", accessKeyId: "public-key", secretAccessKey: "public-secret" });
  });

  it("keeps the shared endpoint when only the originals keys differ", () => {
    const c = bucketConfigs({ ...shared, S3_ORIGINALS_ACCESS_KEY_ID: "k", S3_ORIGINALS_SECRET_ACCESS_KEY: "s" });
    expect(c.originals.endpoint).toBe("https://shared.example");
  });

  it("refuses a half-set key pair with a clear message", () => {
    expect(() => bucketConfigs({ ...shared, S3_ORIGINALS_ACCESS_KEY_ID: "k" })).toThrow(/Set both S3_ORIGINALS_ACCESS_KEY_ID/);
  });
});
