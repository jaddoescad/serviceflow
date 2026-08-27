#!/bin/bash
set -euo pipefail

exec node /opt/data/bin/meta-marketing-daily-sync.mjs --apply
