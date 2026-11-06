# Listing Desk: notes for coding agents

Personal eBay listing tool: photos → Claude draft → human review → publish via eBay APIs. Deployed on Sevalla (Node app + Postgres + S3-compatible buckets on Cloudflare R2). Owner builds with AI agents from a written spec; keep changes small, explained and tested.

## Stack

- Next.js 15 App Router, TypeScript strict, React 19. Route handler `params` are Promises (`await ctx.params`).
- Drizzle ORM + postgres.js. Schema in `src/db/schema.ts`; after editing it run `npm run db:generate` and commit the new file in `drizzle/`. Migrations run on start (`scripts/migrate.mjs`). Prisma was dropped because its engine binaries can't be downloaded in some build sandboxes.
- `@anthropic-ai/sdk` with structured outputs (`output_config.format`, JSON schema) validated by zod (`src/lib/drafting/`). Current models (Sonnet 5.5 and newer) reject forced `tool_choice` (`tool`/`any`), so don't use it. Structured-output schemas must set `additionalProperties: false` on every object, list every property in `required`, and avoid open-ended maps and numeric/length limits; `tests/structured.test.ts` checks this. These models think by default and thinking counts toward `max_tokens`.
- `sharp` for resizing, `heic-convert` for iPhone photos.
- Vitest for unit tests (`tests/`).

## Rules

- Server-only config goes through `env()` in `src/lib/env.ts`; add new variables to its schema AND `.env.example`.
- Never log or return secrets; the eBay refresh token is stored encrypted (`src/lib/crypto.ts`).
- `src/lib/session.ts` and `src/middleware.ts` must stay edge-safe (no Node APIs).
- eBay request bodies are built by pure functions in `src/lib/ebay/listing.ts`; keep them pure and tested.
- Publishing goes through the `ListingPublisher` interface (`src/lib/ebay/publisher.ts`). The default is `TradingApiPublisher` (Trading API `AddFixedPriceItem`, XML built by pure functions in `src/lib/ebay/trading-xml.ts`), because Seller Hub refuses to revise Inventory API listings. `InventoryApiPublisher` remains behind `EBAY_PUBLISHER=inventory`. Each Trading request carries a UUID derived from the listing content plus the item's `relist_count`, so resends are deduplicated by eBay but deliberate relists aren't.
- Categories come from eBay's live category tree (Taxonomy API), cached per category in `category_cache` and refreshed when eBay's tree version changes. Never hard-code a category list. (The only exception is the test fixture in `src/lib/ebay/mock.ts`, ids prefixed `mock-`, used solely when `EBAY_ENV=mock`.)
- Test mode (`EBAY_ENV=mock`): `ebayFetch` hands every call to `mockEbay`, so app code never branches on mock mode except for sign-in (`auth.ts`, connect route) and listing links. Trading API calls go through `tradingCall` (`src/lib/ebay/trading.ts`), which hands them to `mockTrading` (`src/lib/ebay/mock-trading.ts`) in test mode. When adding a new eBay call, add it to the matching mock too, or test mode will answer "Test mode doesn't handle …".
- Ending listings goes through `endEbayListing` (`src/lib/ebay/end-listing.ts`): Inventory API offers are withdrawn, Trading API items ended with `EndFixedPriceItem`. It must confirm the listing's SKU is the item's id before ending anything.
- Condition default: items are used and in working order unless the seller sets "Working order" otherwise (`items.tested` null means works; see `conditionRule` in `src/lib/drafting/prompts.ts`). Never default to "For parts or not working". A condition picked on the review screen is kept when redrafting.
- Every listing passes human review. Don't add auto-publish paths.
- API errors reach the UI as `{ error }` with a readable message (`src/lib/api.ts`).

## Checks before pushing

```bash
npm test && npm run typecheck && npm run build
```

## Roadmap (from the spec)

- Phase 2: presigned direct uploads, folder upload, grouping by divider card / time gaps, background worker using the Message Batches API, review queue with keyboard shortcuts and bulk approve, drip-feed publishing.
- Phase 3: Slab or Sell grading check for comics, lot suggestions, sold sync (Fulfillment API), price drops, Facebook Marketplace export.
