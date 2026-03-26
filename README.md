# feedback-gate

Minimal embeddable TypeScript feedback modal designed to submit structured feedback to configurable endpoints, with Cloudflare Worker → Google Apps Script → Google Sheets as the primary reference integration.

The default production path is frictionless: browser form → Cloudflare Worker → Google Sheet, with rate limiting and honeypot checks in the Worker.

See `work/plan.md` for the current product and architecture plan.
