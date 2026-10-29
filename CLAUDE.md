# Listing Desk: notes for coding agents

Personal eBay listing tool: photos → Claude draft → human review → publish via eBay APIs. Deployed on Sevalla (Node app + Postgres + S3-compatible buckets on Cloudflare R2). Owner builds with AI agents from a written spec; keep changes small, explained and tested.

## Stack

- Next.js 15 App Router, TypeScript strict, React 19. Route handler `params` are Promises (`await ctx.params`).
- Drizzle ORM + postgres.js. Schema in `src/db/schema.ts`; after editing it run `npm run db:generate` and commit the new file in `drizzle/`. Migrations run on start (`scripts/migrate.mjs`). Prisma was dropped because its engine binaries can't be downloaded in some build sandboxes.
- `@anthropic-ai/sdk` with forced tool calls for structured output, validated by zod (`src/lib/drafting/`).
- `sharp` for resizing, `heic-convert` for iPhone photos.
- Vitest for unit tests (`tests/`).

## Rules

- Server-only config goes through `env()` in `src/lib/env.ts`; add new variables to its schema AND `.env.example`.
- Never log or return secrets; the eBay refresh token is stored encrypted (`src/lib/crypto.ts`).
- `src/lib/session.ts` and `src/middleware.ts` must stay edge-safe (no Node APIs).
- eBay request bodies are built by pure functions in `src/lib/ebay/listing.ts`; keep them pure and tested.
- Publishing goes through the `ListingPublisher` interface (`src/lib/ebay/publisher.ts`) so the Inventory API implementation can be swapped for a Trading API one.
- Categories come from eBay's live category tree (Taxonomy API), cached per category in `category_cache` and refreshed when eBay's tree version changes. Never hard-code a category list.
- Every listing passes human review. Don't add auto-publish paths.
- API errors reach the UI as `{ error }` with a readable message (`src/lib/api.ts`).

## Checks before pushing

```bash
npm test && npm run typecheck && npm run build
```

## Roadmap (from the spec)

- Phase 2: presigned direct uploads, folder upload, grouping by divider card / time gaps, background worker using the Message Batches API, review queue with keyboard shortcuts and bulk approve, drip-feed publishing.
- Phase 3: Slab or Sell grading check for comics, lot suggestions, sold sync (Fulfillment API), price drops, Facebook Marketplace export.
