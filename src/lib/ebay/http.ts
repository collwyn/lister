import { env } from "@/lib/env";

export function ebayHosts() {
  const sandbox = env().EBAY_ENV === "sandbox";
  return {
    api: sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
    auth: sandbox ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
  };
}

type EbayErrorItem = {
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

export async function ebayFetch<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(path, ebayHosts().api);
  for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": env().EBAY_MARKETPLACE_ID,
      ...(init.body !== undefined ? { "Content-Type": "application/json", "Content-Language": "en-US" } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const errors = (json as { errors?: EbayErrorItem[] } | null)?.errors ?? [];
    throw new EbayError(res.status, errors, `eBay returned ${res.status} for ${url.pathname}`);
  }
  return json as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { errors: [{ message: text.slice(0, 300) }] };
  }
}
