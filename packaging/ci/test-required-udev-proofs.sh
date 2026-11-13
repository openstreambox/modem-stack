#!/usr/bin/env bash
# The hosted lane must execute both proofs, and cannot pass on an environment skip.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf '#!/bin/bash\nexit "${PROOF_RC}"\n' > "$work/proof.sh"
for required in 0 1; do
 for proof_rc in 0 1 77; do
  expected=$proof_rc
  if [ "$proof_rc" = 77 ]; then
   expected=0
   [ "$required" = 0 ] || expected=1
  fi
  rc=0
  REQUIRE_UDEV_PROOFS=$required PROOF_RC=$proof_rc \
   bash "$HERE/run-udev-proof.sh" "$work/proof.sh" > "$work/output" 2>&1 || rc=$?
  [ "$rc" = "$expected" ] || { cat "$work/output"; echo "required=$required proof=$proof_rc: expected $expected got $rc"; exit 1; }
  if [ "$required:$proof_rc" = 1:77 ]; then grep -q 'ERROR: required udev proof unavailable' "$work/output"; fi
 done
done
workflow="$HERE/../../.github/workflows/ci-packaging.yml"
grep -q 'options: --privileged' "$workflow"
grep -q 'REQUIRE_UDEV_PROOFS: "1"' "$workflow"
for proof in test-companion-udev-match.sh test-companion-udev-empty-run.sh; do
 grep -q "run-udev-proof.sh.*$proof" "$HERE/contract.sh"
done
echo 'required udev proof policy: pass'
