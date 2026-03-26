#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${DRY_RUN:-false}"
WORK_DIR="${WORK_DIR:-$(mktemp -d /tmp/feedback-gate-worker-XXXXXX)}"
WORKER_NAME="${CLOUDFLARE_WORKER_NAME:-feedback-gate}"
COMPATIBILITY_DATE="${CLOUDFLARE_COMPATIBILITY_DATE:-2026-03-26}"
RATE_LIMIT_MAX="${RATE_LIMIT_MAX:-5}"
RATE_LIMIT_WINDOW_SEC="${RATE_LIMIT_WINDOW_SEC:-300}"
WORKERS_DEV="${CLOUDFLARE_WORKERS_DEV:-true}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[deploy-worker] missing env: $name" >&2
    exit 1
  fi
}

emit_output() {
  local key="$1"
  local value="$2"
  echo "$key=$value"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

require_env CLOUDFLARE_API_TOKEN
require_env CLOUDFLARE_ACCOUNT_ID
require_env APPS_SCRIPT_URL
require_env APPS_SCRIPT_SECRET
require_env ALLOWED_ORIGINS

mkdir -p "$WORK_DIR"
cp "$ROOT_DIR/cloudflare/worker.mjs" "$WORK_DIR/worker.mjs"
cp "$ROOT_DIR/cloudflare/feedback-core.mjs" "$WORK_DIR/feedback-core.mjs"
cat > "$WORK_DIR/wrangler.toml" <<EOF
name = "${WORKER_NAME}"
main = "worker.mjs"
compatibility_date = "${COMPATIBILITY_DATE}"
workers_dev = ${WORKERS_DEV}

[durable_objects]
bindings = [
  { name = "FEEDBACK_RATE_LIMITER", class_name = "FeedbackRateLimiter" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["FeedbackRateLimiter"]

[vars]
ALLOWED_ORIGINS = "${ALLOWED_ORIGINS}"
RATE_LIMIT_MAX = "${RATE_LIMIT_MAX}"
RATE_LIMIT_WINDOW_SEC = "${RATE_LIMIT_WINDOW_SEC}"
APPS_SCRIPT_URL = "${APPS_SCRIPT_URL}"
EOF

if [[ "$DRY_RUN" == "true" ]]; then
  endpoint="${FEEDBACK_GATE_ENDPOINT:-https://${WORKER_NAME}.example.workers.dev}"
  emit_output worker_name "$WORKER_NAME"
  emit_output worker_endpoint "$endpoint"
  emit_output work_dir "$WORK_DIR"
  exit 0
fi

pushd "$WORK_DIR" >/dev/null
printf '%s' "$APPS_SCRIPT_SECRET" | npx --yes wrangler secret put APPS_SCRIPT_SECRET --config wrangler.toml >/dev/null

deploy_output="$(npx --yes wrangler deploy --config wrangler.toml 2>&1)"
popd >/dev/null

endpoint="$(printf '%s\n' "$deploy_output" | grep -Eo 'https://[^ ]+' | head -n 1 || true)"
if [[ -z "$endpoint" && -n "${FEEDBACK_GATE_ENDPOINT:-}" ]]; then
  endpoint="$FEEDBACK_GATE_ENDPOINT"
fi
if [[ -z "$endpoint" ]]; then
  echo "$deploy_output" >&2
  echo "[deploy-worker] could not parse worker URL from wrangler output; set FEEDBACK_GATE_ENDPOINT explicitly" >&2
  exit 1
fi

emit_output worker_name "$WORKER_NAME"
emit_output worker_endpoint "$endpoint"
emit_output work_dir "$WORK_DIR"
