1. Deploy the worker from `cloudflare/`.
   - set `APPS_SCRIPT_URL` in `wrangler.toml`
   - `wrangler secret put APPS_SCRIPT_SECRET`
   - `wrangler deploy`

2. In Google Apps Script (`examples/google-apps-script/Code.js`):
   - set `SHEET_NAME`
   - set `NOTIFY_EMAIL`
   - set `SHARED_SECRET` = same value as `APPS_SCRIPT_SECRET`
   - deploy as web app

3. In the Worker config:
   - set `ALLOWED_ORIGINS` to the site origin(s) that can embed the widget
   - wildcard subdomains are supported, e.g. `https://*.impactmesh.xyz`
   - tune `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SEC` as needed

4. On the site:
   - set widget `endpoint` to the Worker URL
   - keep the form frictionless for the user
   - keep Apps Script private behind the Worker only
