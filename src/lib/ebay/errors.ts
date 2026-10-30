export type EbayErrorItem = {
  errorId?: number;
  message?: string;
  longMessage?: string;
  parameters?: { name?: string; value?: string }[];
};

/** An eBay API failure, with eBay's own wording kept for the review screen. */
export class EbayError extends Error {
  constructor(
    public status: number,
    public errors: EbayErrorItem[],
    fallback: string,
  ) {
    super(EbayError.describe(errors) || fallback);
    this.name = "EbayError";
  }
  static describe(errors: EbayErrorItem[]): string {
    return errors
      .map((e) => e.longMessage || e.message)
      .filter(Boolean)
      .join(" ");
  }
  hasErrorId(id: number) {
    return this.errors.some((e) => e.errorId === id);
  }
}
