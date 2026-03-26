1. Create a Turnstile widget.
   - Site key -> put in `protection.turnstile.siteKey`
   - Secret key -> `wrangler secret put TURNSTILE_SECRET_KEY`

2. Deploy the worker from `cloudflare/`.
   - set `APPS_SCRIPT_URL` in `wrangler.toml`
   - `wrangler secret put APPS_SCRIPT_SECRET`
   - `wrangler deploy`

3. In Google Apps Script (`examples/google-apps-script/Code.js`):
   - set `SHEET_NAME`
   - set `NOTIFY_EMAIL`
   - set `SHARED_SECRET` = same value as `APPS_SCRIPT_SECRET`
   - deploy as web app

4. On the site:
   - set widget `endpoint` to the Worker URL
   - set `protection.turnstile.siteKey`
   - keep Apps Script private behind the Worker only
