#!/usr/bin/env bash
# Exercise the match proof in containers that have udevadm but no runtime database.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ "${1:-}" != --inside ]; then
 command -v udevadm >/dev/null || exit 77
 unshare --user --map-root-user --mount true 2>/dev/null || exit 77
 work=$(mktemp -d)
 trap 'rm -rf "$work"' EXIT
 unshare --user --map-root-user --mount bash "$0" --inside "$work"
 exit $?
fi
mount --make-rprivate /
mount -t tmpfs -o ro tmpfs /run
SYSTEMD_DEVICE_VERIFY_SYSFS=0 bash "$HERE/test-companion-udev-match.sh" --inside "$2"
