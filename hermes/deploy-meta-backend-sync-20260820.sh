#!/bin/bash
set -euo pipefail

trap 'status=$?; echo "deployment-error line=$LINENO status=$status"; exit "$status"' ERR

export PATH="/opt/data/bin:$PATH"

archive="/opt/data/ottawa-meta-backend-sync-deploy-20260820.tar.gz"
expected_sha256="bdaf7785c94ff16d979eaee2c2e9f0d2ddfe2d10487f412f11cec7926b4e9e03"
mkdir -p /opt/data/deploy/backups
stage="$(mktemp -d /opt/data/deploy/meta-backend-sync-20260820.XXXXXX)"
backup="$(mktemp -d /opt/data/deploy/backups/meta-backend-sync-20260820.XXXXXX)"

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

echo "archive-checksum=ok"
tar -xzf "$archive" -C "$stage"

checks=(
  scripts/meta-marketing-daily-sync.mjs
  scripts/lib/meta-marketing-sync.mjs
  hermes/scripts/ops-health-monitor.mjs
)
for relative in "${checks[@]}"; do
  node --check "$stage/$relative"
done
node -e "import('/opt/data/bin/node_modules/@supabase/supabase-js/dist/index.mjs').then((module) => { if (typeof module.createClient !== 'function') process.exit(1); console.log('supabase-runtime=ok'); })"

backup_one() {
  local source="$1"
  local relative="$2"
  if [[ -e "$source" ]]; then
    mkdir -p "$backup/$(dirname "$relative")"
    cp -p "$source" "$backup/$relative"
  fi
}

backup_one /opt/data/bin/meta-marketing-daily-sync.mjs bin/meta-marketing-daily-sync.mjs
backup_one /opt/data/bin/lib/meta-marketing-sync.mjs bin/lib/meta-marketing-sync.mjs
backup_one /opt/data/scripts/meta-ads-backend-sync.sh scripts/meta-ads-backend-sync.sh
backup_one /opt/data/scripts/ops-health-monitor.mjs scripts/ops-health-monitor.mjs
echo "backup=$backup"

install -m 755 "$stage/scripts/meta-marketing-daily-sync.mjs" /opt/data/bin/meta-marketing-daily-sync.mjs
install -m 644 "$stage/scripts/lib/meta-marketing-sync.mjs" /opt/data/bin/lib/meta-marketing-sync.mjs
install -m 755 "$stage/hermes/scripts/meta-ads-backend-sync.sh" /opt/data/scripts/meta-ads-backend-sync.sh
install -m 755 "$stage/hermes/scripts/ops-health-monitor.mjs" /opt/data/scripts/ops-health-monitor.mjs

echo "backfill-dry-run-start"
node /opt/data/bin/meta-marketing-daily-sync.mjs --backfill > "$stage/backfill-dry-run.json"
node -e "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(r.status!=='ok'||r.mode!=='dry_run'||r.scope!=='backfill'||!(r.insight_rows>0))process.exit(1);console.log(JSON.stringify({dry_run:'ok',since:r.since,until:r.until,rows:r.insight_rows,requests:r.insight_requests}));" "$stage/backfill-dry-run.json"

echo "backfill-live-run-start"
node /opt/data/bin/meta-marketing-daily-sync.mjs --backfill --apply > "$stage/backfill-live.json"
node -e "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(r.status!=='ok'||r.mode!=='apply'||r.scope!=='backfill'||!(r.persisted_rows>0)||r.verified_scope_rows<r.persisted_rows)process.exit(1);console.log(JSON.stringify({backfill:'ok',since:r.since,until:r.until,persisted:r.persisted_rows,verified:r.verified_scope_rows,customer:r.metrics.customer_acquisition,recruiting:r.metrics.recruiting}));" "$stage/backfill-live.json"

echo "rolling-live-run-start"
node /opt/data/bin/meta-marketing-daily-sync.mjs --apply > "$stage/rolling-live.json"
node -e "const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(r.status!=='ok'||r.mode!=='apply'||r.scope!=='rolling_window'||!(r.persisted_rows>0)||r.verified_scope_rows<r.persisted_rows)process.exit(1);console.log(JSON.stringify({rolling:'ok',since:r.since,until:r.until,persisted:r.persisted_rows,verified:r.verified_scope_rows}));" "$stage/rolling-live.json"

node /opt/data/scripts/ops-health-monitor.mjs --self-test

echo "meta-backend-sync-deployment=verified"
