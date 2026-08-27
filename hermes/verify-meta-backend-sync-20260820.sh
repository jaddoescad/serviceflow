#!/bin/bash
set -euo pipefail

node /opt/data/bin/meta-marketing-daily-sync.mjs --apply
node /opt/data/scripts/ops-health-monitor.mjs --self-test
node /opt/data/scripts/ops-health-monitor.mjs
echo "meta-backend-hosted-verification=ok"
