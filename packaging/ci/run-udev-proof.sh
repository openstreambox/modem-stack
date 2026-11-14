#!/usr/bin/env bash
# Preserve portable local skips; hosted CI requires real proof execution.
set -euo pipefail
rc=0
bash "$@" || rc=$?
if [ "$rc" -eq 77 ]; then
 if [ "${REQUIRE_UDEV_PROOFS:-0}" = 1 ]; then
  echo "ERROR: required udev proof unavailable: $1" >&2
  exit 1
 fi
 echo "SKIP: optional udev proof unavailable: $1"
 exit 0
fi
exit "$rc"
