# feedback-gate

Minimal embeddable TypeScript feedback modal designed to submit structured feedback to configurable endpoints.

## Production architecture

`browser widget -> Cloudflare Worker -> Google Apps Script -> Google Sheet / email`

- `src/feedback-gate.ts`: embeddable browser widget
- `cloudflare/worker.mjs` + `cloudflare/feedback-core.mjs`: public ingestion endpoint, CORS, honeypot, rate limit, forwarder
- `examples/google-apps-script/Code.js`: Apps Script receiver you deploy in Google; writes to Sheet and sends email

## Spam mitigation

- origin allowlist in Worker
- hidden honeypot field in widget, enforced in Worker
- rate limit in Worker (`origin + IP`)
- Apps Script protected by shared secret; browser does not post to it directly

## Deploy

1. Create a Google Sheet and Apps Script project.
2. Copy `examples/google-apps-script/Code.js` into Apps Script.
3. Set in Apps Script:
   - `SHEET_NAME`
   - `NOTIFY_EMAIL`
   - `SHARED_SECRET`
4. Deploy Apps Script as a web app and copy the URL.
5. In `cloudflare/wrangler.toml`, set:
   - `APPS_SCRIPT_URL`
   - `ALLOWED_ORIGINS`
   - `RATE_LIMIT_MAX`
   - `RATE_LIMIT_WINDOW_SEC`
6. Set the Worker secret:
   - `wrangler secret put APPS_SCRIPT_SECRET`
   - value must match Apps Script `SHARED_SECRET`
7. Deploy the Worker.
8. On your site, point the widget `endpoint` to the Worker URL.

## Notes

- Apps Script code lives in this repo at `examples/google-apps-script/Code.js`, then gets copied/deployed into a real Google Apps Script project.
- See `cloudflare/setup.md` for deployment/config.
- See `work/plan.md` for the product plan.
