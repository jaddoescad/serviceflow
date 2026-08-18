#!/usr/bin/env bash
set -euo pipefail

# The dashboard persists shared Gmail controls in the default Hermes .env. A
# long-lived gateway can retain an older process value, so make the persisted
# allowlist authoritative for every scheduled run.
unset HERMES_GMAIL_LABEL_ALLOWLIST
export HERMES_ENV_FILE="/opt/data/.env"

# Read this single non-secret control directly from the persisted dashboard
# file on every run. The scheduler process may keep an older inherited value
# after a dashboard key change, even when the gateway has been restarted.
email_intake_mode="${HERMES_EMAIL_INTAKE_MODE:-dry-run}"
if [[ -r "$HERMES_ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    key="${key#export }"
    if [[ "$key" == "HERMES_EMAIL_INTAKE_MODE" ]]; then
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      email_intake_mode="$value"
    fi
  done < "$HERMES_ENV_FILE"
fi

case "$email_intake_mode" in
  live)
    exec node /opt/data/bin/ottawa-email-intake-cli.mjs poll --limit 25 --yes --json
    ;;
  dry-run)
    exec node /opt/data/bin/ottawa-email-intake-cli.mjs poll --limit 25 --dry-run --json
    ;;
  *)
    printf '%s\n' '{"schema_version":1,"status":"error","wakeAgent":false,"error":"HERMES_EMAIL_INTAKE_MODE must be dry-run or live"}'
    exit 1
    ;;
esac
