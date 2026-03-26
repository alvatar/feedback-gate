#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="${TMP_DIR:-$(mktemp -d /tmp/feedback-gate-deploy-XXXXXX)}"
BARLOVENTO_REPO="${BARLOVENTO_REPO:-alvatar/barlovento}"

apps_output_file="$TMP_DIR/apps-script.env"
worker_output_file="$TMP_DIR/worker.env"

(
  export WORK_DIR="$TMP_DIR/apps-script"
  "$ROOT_DIR/scripts/deploy-apps-script.sh"
) | tee "$apps_output_file"

grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$apps_output_file" > "$apps_output_file.filtered"
set -a
source "$apps_output_file.filtered"
set +a

(
  export WORK_DIR="$TMP_DIR/worker"
  export APPS_SCRIPT_URL="$apps_script_url"
  "$ROOT_DIR/scripts/deploy-worker.sh"
) | tee "$worker_output_file"

grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$worker_output_file" > "$worker_output_file.filtered"
set -a
source "$worker_output_file.filtered"
set +a

if [[ -n "${BARLOVENTO_VARIABLES_TOKEN:-}" ]]; then
  GITHUB_VARIABLES_TOKEN="$BARLOVENTO_VARIABLES_TOKEN" \
  TARGET_REPO="$BARLOVENTO_REPO" \
  VARIABLE_NAME="FEEDBACK_GATE_ENDPOINT" \
  VARIABLE_VALUE="$worker_endpoint" \
  node "$ROOT_DIR/scripts/sync-github-variable.mjs"
fi

echo "apps_script_url=$apps_script_url"
echo "worker_endpoint=$worker_endpoint"
