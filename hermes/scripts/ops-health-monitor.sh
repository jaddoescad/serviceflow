#!/bin/bash
set -euo pipefail

exec node /opt/data/scripts/ops-health-monitor.mjs "$@"
