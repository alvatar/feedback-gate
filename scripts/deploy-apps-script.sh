#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${DRY_RUN:-false}"
WORK_DIR="${WORK_DIR:-$(mktemp -d /tmp/feedback-gate-apps-script-XXXXXX)}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "[deploy-apps-script] missing env: $name" >&2
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

require_env GOOGLE_APPS_SCRIPT_ID
require_env GOOGLE_SHEET_NAME
require_env GOOGLE_NOTIFY_EMAIL
require_env APPS_SCRIPT_SECRET
require_env CLASP_TOKEN

mkdir -p "$WORK_DIR"
node "$ROOT_DIR/scripts/render-apps-script.mjs" \
  --template "$ROOT_DIR/examples/google-apps-script/Code.js" \
  --manifest "$ROOT_DIR/examples/google-apps-script/appsscript.json" \
  --out-dir "$WORK_DIR" \
  --sheet-name "$GOOGLE_SHEET_NAME" \
  --notify-email "$GOOGLE_NOTIFY_EMAIL" \
  --shared-secret "$APPS_SCRIPT_SECRET" >&2

cat > "$WORK_DIR/.clasp.json" <<EOF
{
  "scriptId": "${GOOGLE_APPS_SCRIPT_ID}",
  "rootDir": "."
}
EOF

mkdir -p "$HOME"
printf '%s' "$CLASP_TOKEN" > "$HOME/.clasprc.json"

if [[ "$DRY_RUN" == "true" ]]; then
  deployment_id="${GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID:-AKFYCB_FAKE_DEPLOYMENT_ID}"
  apps_script_url="https://script.google.com/macros/s/${deployment_id}/exec"
  emit_output deployment_id "$deployment_id"
  emit_output apps_script_url "$apps_script_url"
  emit_output work_dir "$WORK_DIR"
  exit 0
fi

pushd "$WORK_DIR" >/dev/null
npx --yes @google/clasp push -f
npx --yes @google/clasp version "CI deploy $(date -u +'%Y-%m-%dT%H:%M:%SZ')" >/dev/null

if [[ -n "${GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID:-}" ]]; then
  deploy_output="$(npx --yes @google/clasp deploy --deploymentId "$GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID" --description "CI deploy $(date -u +'%Y-%m-%dT%H:%M:%SZ')")"
  deployment_id="$GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID"
else
  deploy_output="$(npx --yes @google/clasp deploy --description "CI deploy $(date -u +'%Y-%m-%dT%H:%M:%SZ')")"
  deployment_id="$(printf '%s\n' "$deploy_output" | grep -Eo 'AKf[[:alnum:]_-]+' | head -n 1 || true)"
  if [[ -z "$deployment_id" ]]; then
    echo "$deploy_output" >&2
    echo "[deploy-apps-script] could not parse deployment id from clasp output" >&2
    exit 1
  fi
fi
popd >/dev/null

apps_script_url="https://script.google.com/macros/s/${deployment_id}/exec"
emit_output deployment_id "$deployment_id"
emit_output apps_script_url "$apps_script_url"
emit_output work_dir "$WORK_DIR"
