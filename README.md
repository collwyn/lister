# Listing Desk

Turn item photos into reviewed eBay listings:

1. **Photos in**: upload an item's photos.
2. **Drafts**: Claude identifies the item, eBay's APIs supply a valid category and item specifics, and Claude writes the listing with a suggested price.
3. **Review and list**: check the draft, fix anything, approve, and publish to eBay.

Runs on [Sevalla](https://sevalla.com) (app + Postgres + S3-compatible object storage).
Full setup instructions arrive with the Phase 1 pull request.
