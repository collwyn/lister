# Listing Desk

Turn item photos into reviewed eBay listings:

1. **Photos in**: upload an item's photos.
2. **Drafts**: Claude identifies the item, eBay's own APIs supply a valid category (from eBay's full category tree), item specifics and comparable listings, and Claude writes the listing with a suggested price.
3. **Review and list**: check the draft, fix anything, approve, and publish to eBay.

Runs on [Sevalla](https://sevalla.com): one Node app, a managed Postgres database, and two S3-compatible buckets.

**Status: Phase 1** (one item end to end). Phase 2 adds folder uploads, photo grouping, background drafting and the fast review queue. See the build spec for the full plan.

---

## Setup

You need four accounts: Sevalla, eBay Developers Program, Anthropic (Claude Console), and GitHub (this repo). Do everything in eBay's **sandbox** first.

### 1. Sevalla

1. **Database**: create a PostgreSQL database. Copy its *internal* connection URL (used by apps in the same Sevalla project).
2. **Object storage**: create two buckets:
   - `listing-desk-originals`: leave **private**.
   - `listing-desk-photos`: turn on **public access**. Its public URL looks like `https://listing-desk-photos.sevalla.storage`.
   Any names work; put the real names in `S3_BUCKET_ORIGINALS` and `S3_BUCKET_PUBLIC`.
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
3. *Turn on business policies*, then *Create sandbox test policies* (sandbox only), pick them and *Save policies*.
4. Enter your ship-from city, state and ZIP, *Save location*.
5. **New item** → upload a few photos of one item. Claude writes the draft (30–90 seconds).
6. Review, edit, *Approve and list on eBay*. The confirmation links to the sandbox listing.

### 5. The Phase 1 gate: can you edit API-created listings in Seller Hub?

Listings created through eBay's Inventory API [can't be revised with the older Trading API](https://developer.ebay.com/develop/guides/sell/listing-management), and eBay doesn't document how well they edit in Seller Hub. Before listing for real:

1. Switch to production (below) and list one cheap item.
2. In Seller Hub, change its price and description.
3. If that works, carry on. If not, the publisher is swapped for a Trading API version in `src/lib/ebay/publisher.ts` (everything else stays the same).

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
