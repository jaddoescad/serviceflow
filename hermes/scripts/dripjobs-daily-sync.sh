#!/bin/bash
set -euo pipefail

export HERMES_AGENT_BROWSER_BIN="${HERMES_AGENT_BROWSER_BIN:-/opt/data/bin/agent-browser}"

mode="${HERMES_DRIPJOBS_SYNC_MODE:-}"
if [[ -z "$mode" && -r /opt/data/.env ]]; then
  mode="$(sed -n 's/^HERMES_DRIPJOBS_SYNC_MODE=//p' /opt/data/.env | tail -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
fi

case "${mode:-dry-run}" in
  live)
    exec node /opt/data/bin/dripjobs-daily-sync-runner.mjs --yes
    ;;
  dry-run)
    exec node /opt/data/bin/dripjobs-daily-sync-runner.mjs --dry-run
    ;;
  *)
    echo "🚨 DripJobs operations sync failed — HERMES_DRIPJOBS_SYNC_MODE must be dry-run or live. No validated DripJobs data was changed."
    exit 1
    ;;
esac
