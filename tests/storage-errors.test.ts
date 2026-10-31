import { describe, expect, it } from "vitest";
import { describeStorageError } from "@/lib/storage";

const ctx = { which: "originals" as const, bucket: "photobucket1-originals", action: "save an original photo", ownOriginalsKeys: true };

describe("describeStorageError", () => {
  it("names the bucket and the settings to check on Access Denied", () => {
    const err = describeStorageError({ name: "AccessDenied", Code: "AccessDenied", message: "Access Denied" }, ctx);
    expect(err.code).toBe("AccessDenied");
    expect(err.message).toContain('private originals bucket "photobucket1-originals" refused');
    expect(err.message).toContain("S3_ORIGINALS_ACCESS_KEY_ID");
  });

  it("points at the shared keys when the originals bucket has no keys of its own", () => {
    const err = describeStorageError({ name: "AccessDenied" }, { ...ctx, ownOriginalsKeys: false });
    expect(err.message).toContain("shared, since S3_ORIGINALS_* are empty");
  });

  it("names the public bucket's settings for the public bucket", () => {
    const err = describeStorageError({ name: "InvalidAccessKeyId" }, { ...ctx, which: "public", bucket: "photobucket1" });
    expect(err.message).toContain('public photos bucket "photobucket1"');
    expect(err.message).toContain("S3_ACCESS_KEY_ID");
    expect(err.message).not.toContain("S3_ORIGINALS");
  });

  it("explains a wrong bucket name", () => {
    const err = describeStorageError({ name: "NoSuchBucket" }, ctx);
    expect(err.message).toContain("S3_BUCKET_ORIGINALS");
  });

  it("never includes key values", () => {
    const err = describeStorageError({ name: "AccessDenied", message: "secret-key-value" }, ctx);
    expect(err.message).not.toContain("secret-key-value");
  });
});
