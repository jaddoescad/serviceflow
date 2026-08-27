#!/bin/bash
set -euo pipefail

trap 'status=$?; echo "deployment-error line=$LINENO status=$status"; exit "$status"' ERR

export PATH="/opt/data/bin:$PATH"

archive="/opt/data/ottawa-dripjobs-operations-deploy-20260820.tar.gz"
expected_sha256="ac406ee48ffe9dfc37534adc03be283f9250ba296d59dca6dea2979aebb10721"
mkdir -p /opt/data/deploy/backups
stage="$(mktemp -d /opt/data/deploy/dripjobs-operations-20260820.XXXXXX)"
backup="$(mktemp -d /opt/data/deploy/backups/dripjobs-operations-20260820.XXXXXX)"

actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "Deployment archive checksum mismatch; nothing was installed."
  exit 1
fi

if [[ ! -r /opt/data/hermes-job-amounts.env ]]; then
  echo "Missing /opt/data/hermes-job-amounts.env; nothing was installed."
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "Missing prerequisite: node"
  exit 1
fi
if ! command -v agent-browser >/dev/null; then
  echo "Missing prerequisite: agent-browser"
  exit 1
fi

echo "archive-checksum=ok"
tar -xzf "$archive" -C "$stage"

checks=(
  scripts/dripjobs-daily-sync-runner.mjs
  scripts/import-invoice-list-job-amounts.mjs
  scripts/import-dripjobs-sales-list.mjs
  scripts/lib/dripjobs-invoice-list.mjs
  scripts/lib/dripjobs-jobs-list.mjs
  scripts/lib/dripjobs-sales-list.mjs
  scripts/lib/dripjobs-job-authority.mjs
  hermes/scripts/ops-health-monitor.mjs
)
for relative in "${checks[@]}"; do
  node --check "$stage/$relative"
done

node -e "import('/opt/data/bin/node_modules/@supabase/supabase-js/dist/index.mjs').then((module) => { if (typeof module.createClient !== 'function') process.exit(1); console.log('supabase-runtime=ok'); })"
agent-browser --version

backup_one() {
  local source="$1"
  local relative="$2"
  if [[ -e "$source" ]]; then
    mkdir -p "$backup/$(dirname "$relative")"
    cp -p "$source" "$backup/$relative"
  fi
}

backup_one /opt/data/bin/dripjobs-daily-sync-runner.mjs bin/dripjobs-daily-sync-runner.mjs
backup_one /opt/data/bin/import-invoice-list-job-amounts.mjs bin/import-invoice-list-job-amounts.mjs
backup_one /opt/data/bin/import-dripjobs-sales-list.mjs bin/import-dripjobs-sales-list.mjs
backup_one /opt/data/bin/lib/dripjobs-invoice-list.mjs bin/lib/dripjobs-invoice-list.mjs
backup_one /opt/data/bin/lib/dripjobs-jobs-list.mjs bin/lib/dripjobs-jobs-list.mjs
backup_one /opt/data/bin/lib/dripjobs-sales-list.mjs bin/lib/dripjobs-sales-list.mjs
backup_one /opt/data/bin/lib/dripjobs-job-authority.mjs bin/lib/dripjobs-job-authority.mjs
backup_one /opt/data/scripts/dripjobs-daily-sync.sh scripts/dripjobs-daily-sync.sh
backup_one /opt/data/scripts/ops-health-monitor.mjs scripts/ops-health-monitor.mjs
backup_one /opt/data/scripts/ops-health-monitor.sh scripts/ops-health-monitor.sh
echo "backup=$backup"

install -m 755 "$stage/scripts/dripjobs-daily-sync-runner.mjs" /opt/data/bin/dripjobs-daily-sync-runner.mjs
install -m 755 "$stage/scripts/import-invoice-list-job-amounts.mjs" /opt/data/bin/import-invoice-list-job-amounts.mjs
install -m 755 "$stage/scripts/import-dripjobs-sales-list.mjs" /opt/data/bin/import-dripjobs-sales-list.mjs
install -m 644 "$stage/scripts/lib/dripjobs-invoice-list.mjs" /opt/data/bin/lib/dripjobs-invoice-list.mjs
install -m 644 "$stage/scripts/lib/dripjobs-jobs-list.mjs" /opt/data/bin/lib/dripjobs-jobs-list.mjs
install -m 644 "$stage/scripts/lib/dripjobs-sales-list.mjs" /opt/data/bin/lib/dripjobs-sales-list.mjs
install -m 644 "$stage/scripts/lib/dripjobs-job-authority.mjs" /opt/data/bin/lib/dripjobs-job-authority.mjs
install -m 755 "$stage/hermes/scripts/dripjobs-daily-sync.sh" /opt/data/scripts/dripjobs-daily-sync.sh
install -m 755 "$stage/hermes/scripts/ops-health-monitor.mjs" /opt/data/scripts/ops-health-monitor.mjs
install -m 755 "$stage/hermes/scripts/ops-health-monitor.sh" /opt/data/scripts/ops-health-monitor.sh

sync_mode="$(sed -n 's/^HERMES_DRIPJOBS_SYNC_MODE=//p' /opt/data/.env | tail -n 1 | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
if [[ "$sync_mode" != "live" ]]; then
  echo "Expected existing HERMES_DRIPJOBS_SYNC_MODE=live, found '${sync_mode:-unset}'. Files are installed, but no live run was attempted."
  exit 1
fi

echo "dry-run-start"
node /opt/data/bin/dripjobs-daily-sync-runner.mjs --dry-run
echo "live-run-start"
node /opt/data/bin/dripjobs-daily-sync-runner.mjs --yes

node -e "const fs=require('node:fs'); const h=JSON.parse(fs.readFileSync('/opt/data/state/dripjobs-sync/health.json','utf8')); if(h.schema_version!==5||h.status!=='ok'||h.mode!=='live'||h.validation_status!=='accepted'||!(h.last_row_count>0)||!(h.last_canonical_sales_deals>=1200)||h.last_persisted_sales_deals!==h.last_sales_row_count||h.consecutive_errors!==0) process.exit(1); console.log(JSON.stringify({health:'ok',schema:h.schema_version,mode:h.mode,jobs:h.last_row_count,recently_changed_deals:h.last_sales_row_count,canonical_deals:h.last_canonical_sales_deals,persisted_deals:h.last_persisted_sales_deals,unlinked_deals:h.last_unlinked_sales_deals,job_changes:h.last_applied_operational_value_changes,lead_changes:h.last_applied_lead_value_changes}));"

node /opt/data/scripts/ops-health-monitor.mjs --self-test
node /opt/data/scripts/ops-health-monitor.mjs
hermes cron list > "$stage/cron-list.txt"
grep -Fq "c26e43bc139b" "$stage/cron-list.txt"
grep -Fq "0f2318f9f1bb" "$stage/cron-list.txt"

echo "dripjobs-operations-deployment=verified"
