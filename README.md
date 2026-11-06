# Listing Desk

Turn item photos into reviewed eBay listings:

1. **Photos in**: upload an item's photos.
2. **Drafts**: Claude identifies the item, eBay's own APIs supply a valid category (from eBay's full category tree), item specifics and comparable listings, and Claude writes the listing with a suggested price.
3. **Review and list**: check the draft, fix anything, approve, and publish to eBay.

Runs on [Sevalla](https://sevalla.com): one Node app, a managed Postgres database, and two S3-compatible buckets.

**Status: Phase 2 in progress.** Batch upload, photo grouping and background drafting are in; the fast review queue, cheaper batch drafting and the "Ready to list" tray come next. See the build spec for the full plan.

## Batches: many items at once

1. **Add photos** → choose any number of photos (or a whole folder on a computer). Photograph items one after another and take one photo of the **divider card** between items (Add photos → *Print a divider card*).
2. The app sorts the photos by when they were taken (the photo's date stamp, else Galaxy/Android file names like `20261106_141523.jpg`), starts a new item at each divider card, and leaves the cards out. Without divider cards it groups by pauses between photos. Claude looks at any group that seems off (no dividers, a long pause, too many photos) and fixes the boundaries.
3. **Check the groups:** tap a photo to start a new item from it, move it to the item before or after, make it the main photo, mark it as a divider or leave it out. Nothing is drafted until you press **Looks right: draft N items**.
4. Items are drafted in the background (`DRAFT_CONCURRENCY`, default 2 at a time), then appear on the items page for review as before.

---

## Setup

You need four accounts: Sevalla, eBay Developers Program, Anthropic (Claude Console), and GitHub (this repo). Do everything in eBay's **sandbox** first.

### 0. Waiting on eBay? Start in test mode

eBay takes a while to approve a new developer account. Meanwhile, set `EBAY_ENV=mock` and leave the `EBAY_*` key variables empty. Everything else is real: Sevalla, your buckets, photo processing, Claude's drafts, the review screen and the publish flow. eBay is simulated:

- **Connect eBay** connects instantly; **Create test policies** adds test payment, return and shipping policies.
- Categories come from a small built-in test set (comics, books, magazines, electronics, household, records, tools, toys and a catch-all), not eBay's full tree.
- There are no price comparisons, so prices show low confidence.
- **Approve and list** checks the listing the way eBay does (required item specifics, allowed condition) and records a test listing ID. Nothing is sent to eBay.

The header shows **Test mode: no eBay**. When your eBay keys arrive, fill them in and change `EBAY_ENV` to `sandbox`. Items you listed in test mode can then be listed for real; test settings and listings are kept separately.

Follow steps 1, 3 and 4 below now; do step 2 when eBay approves you.

### 1. Sevalla

1. **Database**: create a PostgreSQL database. Copy its *internal* connection URL (used by apps in the same Sevalla project).
2. **Object storage**: create two buckets:
   - `listing-desk-originals`: leave **private**.
   - `listing-desk-photos`: turn on **public access**. Copy its public address into `PUBLIC_PHOTO_BASE_URL`.
   Any names work, but the variables need each bucket's **Bucket name** from Settings → Details, not the display name: Sevalla adds a short suffix (e.g. `listing-desk-photos-x7k2m`). Put those in `S3_BUCKET_ORIGINALS` and `S3_BUCKET_PUBLIC`.
   From the **public** bucket's connection details, copy the S3 endpoint, access key ID and secret key into `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
   If the **private** bucket shows different values (Sevalla usually gives each bucket its own keys), copy them into `S3_ORIGINALS_ENDPOINT`, `S3_ORIGINALS_ACCESS_KEY_ID` and `S3_ORIGINALS_SECRET_ACCESS_KEY`.
3. **Application**: create an app from this GitHub repo.
   - Build command: `npm run build` (Sevalla detects Node automatically)
   - Start command: `npm start` (runs database migrations, then starts the app)
   - Connect the database to the app.
4. **Environment variables**: add every variable in [`.env.example`](.env.example). Notes:
   - `APP_BASE_URL`: the app's Sevalla URL (or your custom domain), no trailing slash.
   - `ADMIN_PASSWORD_HASH`: on your computer, run `npm install` once, then `npm run hash-password -- "a long password"` and paste the output.
   - `SESSION_SECRET` and `ENCRYPTION_KEY`: two different random values from `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   - `EBAY_VERIFICATION_TOKEN`: any 32–80 character string you make up (letters, numbers, `-`, `_`).
5. Deploy. Open `APP_BASE_URL/api/health`; it should answer `{"ok":true,...}`.

### 2. eBay (sandbox)

On [developer.ebay.com](https://developer.ebay.com):

1. **Application Keys**: create a **Sandbox** keyset. Copy the App ID (`EBAY_CLIENT_ID`) and Cert ID (`EBAY_CLIENT_SECRET`).
2. **Sandbox test user**: create one (Sandbox User Registration). You'll sign in with it when you press *Connect eBay*.
3. **User Tokens** → *Get a Token from eBay via Your Application* → add a RuName (redirect URL name):
   - Auth accepted URL: `APP_BASE_URL/api/ebay/callback`
   - Auth declined URL: `APP_BASE_URL/settings`
   - Privacy policy URL: required; any page you control.
   - Copy the RuName value into `EBAY_RUNAME`.
4. **Alerts & Notifications** → *Marketplace Account Deletion*:
   - Endpoint: `APP_BASE_URL/api/ebay/account-deletion`
   - Verification token: your `EBAY_VERIFICATION_TOKEN`
   - eBay immediately sends a test challenge; the app answers it. Production keys stay disabled until this is done.

### 3. Claude

Create an API key in the [Claude Console](https://platform.claude.com) and set `ANTHROPIC_API_KEY`. Optionally set `CLAUDE_MODEL` (default `claude-sonnet-5-5`).

### 4. In the app

1. Sign in with your password.
2. **Settings** → *Connect eBay*, sign in with the sandbox test user, approve.
3. *Turn on business policies*, then *Create test policies* (sandbox and test mode only), pick them and *Save policies*.
4. Enter your ship-from city, state and ZIP, *Save location*.
5. **New item** → upload a few photos of one item. Claude writes the draft (30–90 seconds).
6. Review, edit, *Approve and list on eBay*. The confirmation links to the sandbox listing.

### 5. How listings are created (and the Phase 1 test)

The Phase 1 test found that listings created through eBay's **Inventory API** can't be revised in Seller Hub ("Inventory-based listing management is not currently supported by this tool"). So the app now creates listings with eBay's **Trading API** (`AddFixedPriceItem`), which makes ordinary listings you can edit in Seller Hub like hand-made ones. `EBAY_PUBLISHER=inventory` switches back to the old method; leave it unset.

- **Ship-from ZIP:** Trading API listings carry your ZIP code. Open Settings and save your ship-from location once (again, if you saved it before this change).
- **Duplicates:** each publish carries an ID eBay uses to reject repeats, so a double click or a timeout can't create two listings.
- **Ending a listing:** open the item → **End this listing → End listing on eBay**. This works for both kinds of listing, including older Inventory API ones that Seller Hub can't end, and puts the item back in review. If you already ended it in Seller Hub, use **Clear listing and edit again** instead (that only updates the app).
- **"You already have this item on eBay":** eBay refuses a second identical listing while the first is up. The review screen then offers **End listing … on eBay** for the earlier listing; press it, then approve and list again. The app only ends a listing after confirming on eBay that it carries this item's SKU.

Before listing for real, still list one inexpensive item in production and confirm you can change its price and description in Seller Hub.

### 6. Going to production

1. Create a **Production** keyset, add a production RuName (same URLs) and register the account deletion endpoint for production.
2. In Seller Hub, create your real business policies (payment, returns, 3–4 shipping policies by size).
3. Change `EBAY_ENV=production` and the three `EBAY_*` key values in Sevalla, redeploy.
4. In Settings, *Connect eBay* with your real seller account, pick your policies, save your location.

Sandbox and production settings are stored separately, so switching back and forth is safe.

---

## Development

```bash
npm install
cp .env.example .env      # fill in values; a local Postgres works for DATABASE_URL
npm run db:migrate        # apply migrations
npm run dev               # http://localhost:3000
npm test                  # unit tests
npm run typecheck
```

After changing `src/db/schema.ts`, run `npm run db:generate` to create a new SQL migration in `drizzle/`, and commit it.

### Layout

| Path | What it is |
| --- | --- |
| `src/app/` | Pages (items, new item, item review, settings, login) and API routes |
| `src/components/DraftEditor.tsx` | The review screen |
| `src/lib/drafting/` | Claude prompts and the identify → category → write pipeline |
| `src/lib/grouping/` | Capture times, divider-card detection, grouping rules, Claude's grouping check, grouping-screen edits |
| `src/lib/uploads.ts` | Batch upload, grouping and confirm |
| `src/lib/worker.ts` | Background drafting (started from `src/instrumentation.ts`) |
| `src/lib/ebay/` | eBay auth, categories, comps, policies, listing bodies, publisher |
| `src/lib/items.ts` | Upload, load, save edits, publish |
| `src/db/schema.ts` | Database tables (Drizzle) |
| `drizzle/` | SQL migrations, applied on every start |
| `tests/` | Vitest unit tests |

### Security notes

- One password-protected user. Sessions are signed, httpOnly cookies.
- The eBay refresh token is encrypted at rest (AES-256-GCM, `ENCRYPTION_KEY`).
- All keys stay server-side. The only unauthenticated endpoints are `/login`, `/api/health` and the eBay account deletion endpoint.
- Listing photos live in a public bucket under random file names; originals stay private.
