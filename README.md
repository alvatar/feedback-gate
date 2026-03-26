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

## Notes

- Apps Script code lives in this repo at `examples/google-apps-script/Code.js`, then gets copied/deployed into a real Google Apps Script project.
- See `cloudflare/setup.md` for deployment/config.
- See `work/plan.md` for the product plan.
