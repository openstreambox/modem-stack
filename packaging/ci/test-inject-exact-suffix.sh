#!/usr/bin/env bash
# test-inject-exact-suffix.sh — EXACT_SUFFIX (downstream rebuild of a released source).
# Needs dpkg-dev and devscripts (run in debian:trixie, like the other packaging contracts).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fail=1; fi; }

fresh() {
	rm -rf "$WORK/pkg"
	mkdir -p "$WORK/pkg/ci" "$WORK/pkg/ModemManager/debian"
	cp "$PKG_ROOT/ci/inject-deb-version.sh" "$PKG_ROOT/ci/tag-guard.sh" "$WORK/pkg/ci/"
	cp "$PKG_ROOT/ModemManager/debian/changelog" "$WORK/pkg/ModemManager/debian/"
}
top() { dpkg-parsechangelog -l "$WORK/pkg/ModemManager/debian/changelog" -S Version; }
base="$(dpkg-parsechangelog -l "$PKG_ROOT/ModemManager/debian/changelog" -S Version)"
base="${base%%~ceralive*}"

fresh
EXACT_SUFFIX='~ceralive.3+osb1' DEBEMAIL=ci@example.invalid DEBFULLNAME=ci \
	bash "$WORK/pkg/ci/inject-deb-version.sh" --source modemmanager --dev 2>/dev/null
check "exact suffix replaces the dev suffix" '[ "$(top)" = "${base}~ceralive.3+osb1" ]'
check "sorts above the released counter" 'dpkg --compare-versions "$(top)" gt "${base}~ceralive.3"'
check "sorts below the next upstream counter" 'dpkg --compare-versions "$(top)" lt "${base}~ceralive.4"'

fresh
DEBEMAIL=ci@example.invalid DEBFULLNAME=ci \
	bash "$WORK/pkg/ci/inject-deb-version.sh" --source modemmanager --dev 2>/dev/null
check "unset EXACT_SUFFIX keeps the dev suffix" '[ "$(top)" = "${base}~ceralive0.0.0~dev" ]'

for bad in '~ceralive.3' '+osb1' '~ceralive.0+osb1' '~ceralive.3+osb0' '~ceralive.3+OSB1' '~ceralive.3+osb1~x'; do
	fresh
	rc=0
	EXACT_SUFFIX="$bad" DEBEMAIL=ci@example.invalid DEBFULLNAME=ci \
		bash "$WORK/pkg/ci/inject-deb-version.sh" --source modemmanager --dev >/dev/null 2>&1 || rc=$?
	check "malformed EXACT_SUFFIX '$bad' is refused" '[ "$rc" -eq 2 ]'
	check "malformed EXACT_SUFFIX '$bad' leaves the changelog alone" 'cmp -s "$WORK/pkg/ModemManager/debian/changelog" "$PKG_ROOT/ModemManager/debian/changelog"'
done

exit "$fail"
