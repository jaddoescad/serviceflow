#!/usr/bin/env bash
set -euo pipefail

export HERMES_ENV_FILE="/opt/data/.env"

contractor_invoice_mode="${HERMES_CONTRACTOR_INVOICE_MODE:-dry-run}"
if [[ -r "$HERMES_ENV_FILE" ]]; then
  while IFS='=' read -r key value; do
    key="${key#export }"
    if [[ "$key" == "HERMES_CONTRACTOR_INVOICE_MODE" ]]; then
      value="${value%$'\r'}"
      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      contractor_invoice_mode="$value"
    fi
  done < "$HERMES_ENV_FILE"
fi

case "$contractor_invoice_mode" in
  live)
    exec node /opt/data/bin/ottawa-contractor-invoice-cli.mjs poll --limit 10 --yes --json
    ;;
  dry-run)
    exec node /opt/data/bin/ottawa-contractor-invoice-cli.mjs poll --limit 10 --dry-run --json
    ;;
  *)
    printf '%s\n' '{"schema_version":1,"status":"error","wakeAgent":false,"error":"HERMES_CONTRACTOR_INVOICE_MODE must be dry-run or live"}'
    exit 1
    ;;
esac
