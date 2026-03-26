# feedback-gate

Minimal embeddable TypeScript feedback modal designed to submit structured feedback to configurable endpoints.

## Production architecture

`browser widget -> Cloudflare Worker -> Google Apps Script -> Google Sheet / email`

- `src/feedback-gate.ts`: embeddable browser widget
- `cloudflare/worker.mjs` + `cloudflare/feedback-core.mjs`: public ingestion endpoint, CORS, honeypot, rate limit, forwarder
- `examples/google-apps-script/Code.js`: Apps Script receiver you deploy in Google; writes to Sheet and sends email

## Spam mitigation

- origin allowlist in Worker (`https://*.impactmesh.xyz` supported)
- hidden honeypot field in widget, enforced in Worker
- rate limit in Worker (`origin + IP`)
- Apps Script protected by shared secret; browser does not post to it directly

## 1. Set up feedback-gate service

Do this once for the shared backend/service.

1. Create a Google Sheet and Apps Script project.
2. Copy `examples/google-apps-script/Code.js` into Apps Script.
3. Set in Apps Script:
   - `SHEET_NAME`
   - `NOTIFY_EMAIL`
   - `SHARED_SECRET`
4. Deploy Apps Script as a web app and copy the URL.
5. Configure the Cloudflare Worker with:
   - `APPS_SCRIPT_URL`
   - `ALLOWED_ORIGINS`
   - `RATE_LIMIT_MAX`
   - `RATE_LIMIT_WINDOW_SEC`
6. Set Worker secret `APPS_SCRIPT_SECRET`.
   - value must match Apps Script `SHARED_SECRET`
7. Deploy the Worker.
8. If you want a custom hostname, point DNS at Cloudflare and bind a route such as `feedback.example.com`.

## 2. Integrate feedback-gate in a site

Do this in each frontend/project that uses the service.

1. Import `FeedbackGate`.
2. Set `endpoint` to the deployed Worker URL.
3. Attach it to an existing button or let it render its own trigger.
4. Configure fields, text, and theme.

```js
new FeedbackGate({
  endpoint: 'https://feedback.example.com',
  target: '#feedback-button',
  strings: {
    title: 'Product feedback',
    description: 'Short, specific feedback is best.',
    submitLabel: 'Send',
  },
  message: {
    placeholder: 'What happened?',
    rows: 6,
  },
  theme: {
    accentColor: '#7c3aed',
    borderRadius: '20px',
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      label: 'Type',
      required: true,
      placeholder: 'Choose one',
      options: ['bug', 'idea', 'question'],
    },
    {
      name: 'email',
      type: 'email',
      label: 'Reply email',
      placeholder: 'you@example.com',
    },
  ],
});
```

- change copy with `strings`
- change colors/radius with `theme`
- change fields with `fields`
- use `classes` if you want to attach your own CSS classes

## Notes

- Apps Script code lives in this repo at `examples/google-apps-script/Code.js`, then gets copied/deployed into a real Google Apps Script project.
- See `cloudflare/setup.md` for deployment/config.
- See `work/plan.md` for the product plan.
