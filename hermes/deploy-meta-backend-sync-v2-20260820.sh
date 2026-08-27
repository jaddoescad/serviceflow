#!/bin/bash
set -euo pipefail

legacy_env="/opt/data/hermes-meta-ads.env"
created_compatibility_file=0

if [[ ! -e "$legacy_env" ]]; then
  install -m 600 /dev/null "$legacy_env"
  created_compatibility_file=1
fi

cleanup() {
  if [[ "$created_compatibility_file" == "1" ]]; then
    rm -f "$legacy_env"
  fi
}
trap cleanup EXIT

bash /opt/data/scripts/deploy-meta-backend-sync-20260820.sh
