#!/usr/bin/env bash
# test-companion-udev-match.sh — what the companion's udev rules MATCH, proven with the
# real `udevadm test` against a fake sysfs tree. No modem, no root, no host udev state.
#
# It re-executes itself in an unprivileged user + mount namespace, bind-mounts a generated
# tree over /sys, hides every host rules directory behind tmpfs and installs ONLY the
# packaged 60-ceralive-modem.rules, then reads the properties `udevadm test` reports.
# SYSTEMD_DEVICE_VERIFY_SYSFS=0 is systemd's own switch for a sysfs that is not a sysfs
# mount. The consumer proof on a real modem stays bench-gated (packaging/README.md).
#
# Exit 0 = pass, 1 = a match is wrong, 77 = this environment cannot run it (no udevadm,
# no unprivileged user namespaces); contract.sh reports 77 as a loud skip.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="$HERE/../ceralive-modem-support/assets/udev/60-ceralive-modem.rules"

if [ "${1:-}" != "--inside" ]; then
	command -v udevadm >/dev/null 2>&1 || { echo "SKIP: no udevadm"; exit 77; }
	command -v unshare >/dev/null 2>&1 || { echo "SKIP: no unshare"; exit 77; }
	unshare --user --map-root-user --mount true 2>/dev/null \
		|| { echo "SKIP: unprivileged user namespaces unavailable"; exit 77; }
	work="$(mktemp -d)"
	trap 'rm -rf "$work"' EXIT
	SYSTEMD_DEVICE_VERIFY_SYSFS=0 unshare --user --map-root-user --mount \
		bash "${BASH_SOURCE[0]}" --inside "$work"
	exit $?
fi

work="$2"
fail=0
SYS="$work/sys"
mkdir -p "$SYS/bus/usb" "$SYS/bus/usb-serial" "$SYS/class/tty" "$SYS/class/net"

# usb_device VID PID BUS-PORT → creates a USB device node under a fake host controller.
usb_device() {
	local d="$SYS/devices/pci0000:00/usb2/$3"
	mkdir -p "$d"
	printf '%s\n' "$1" >"$d/idVendor"
	printf '%s\n' "$2" >"$d/idProduct"
	printf 'DEVTYPE=usb_device\nDRIVER=usb\nPRODUCT=%s/%s/504\n' "$1" "$2" >"$d/uevent"
	ln -s ../../../../bus/usb "$d/subsystem"
}

# tty_on BUS-PORT IFNUM → an option-driver tty on that interface; prints its syspath.
tty_on() {
	local i="$SYS/devices/pci0000:00/usb2/$1/$1:1.$2" n="ttyUSB$2"
	mkdir -p "$i/$n/tty/$n"
	printf '%02d\n' "$2" >"$i/bInterfaceNumber"
	printf 'ff\n' >"$i/bInterfaceClass"
	printf '00\n' >"$i/bInterfaceSubClass"
	printf 'DEVTYPE=usb_interface\nDRIVER=option\nINTERFACE=255/0/0\n' >"$i/uevent"
	ln -s ../../../../../bus/usb "$i/subsystem"
	printf 'DRIVER=option1\n' >"$i/$n/uevent"
	ln -s ../../../../../../bus/usb-serial "$i/$n/subsystem"
	printf 'MAJOR=188\nMINOR=%d\nDEVNAME=%s\n' "$2" "$n" >"$i/$n/tty/$n/uevent"
	printf '188:%d\n' "$2" >"$i/$n/tty/$n/dev"
	ln -s ../../../../../../../../class/tty "$i/$n/tty/$n/subsystem"
	echo "/sys/devices/pci0000:00/usb2/$1/$1:1.$2/$n/tty/$n"
}

usb_device 2c7c 0801 2-1 # RM520N-GL
usb_device 2c7c 0800 2-2 # another Quectel PID
usb_device 1e0e 9001 2-3 # SIM7600G-H, a tagged SKU of this file
rm520_if0="$(tty_on 2-1 0)"
rm520_if1="$(tty_on 2-1 1)"
rm520_if2="$(tty_on 2-1 2)"
rm520_if3="$(tty_on 2-1 3)"
other_if3="$(tty_on 2-2 3)"
simcom_if3="$(tty_on 2-3 3)"

mount --bind "$SYS" /sys
for d in /etc/udev/rules.d /usr/lib/udev/rules.d /lib/udev/rules.d /usr/local/lib/udev/rules.d /run/udev; do
	[ -d "$d" ] && mount -t tmpfs tmpfs "$d"
done
mkdir -p /run/udev/rules.d /usr/lib/udev/rules.d
cp "$RULES" /usr/lib/udev/rules.d/60-ceralive-modem.rules

props() { # ACTION SYSPATH → the property list `udevadm test` computed
	udevadm test --action="$1" "$2" 2>/dev/null | sed -n '/^Properties:/,$p'
}
expect_has() { # NAME ACTION SYSPATH PROPERTY
	if props "$2" "$3" | grep -qx "  $4"; then echo "  ok: $1"; else echo "  FAIL: $1 (no $4)"; fail=1; fi
}
expect_lacks() { # NAME ACTION SYSPATH PROPERTY-PREFIX
	if props "$2" "$3" | grep -q "^  $4"; then echo "  FAIL: $1 (has $4)"; fail=1; else echo "  ok: $1"; fi
}

echo "companion udev match proofs (udevadm $(udevadm --version))"
expect_has "RM520 interface 3 tty is released to read-only tools" add "$rm520_if3" "ID_MM_PORT_IGNORE=1"
expect_has "the release also holds on a change event" change "$rm520_if3" "ID_MM_PORT_IGNORE=1"
expect_lacks "RM520 interface 2 (primary AT) stays with ModemManager" add "$rm520_if2" "ID_MM_PORT_IGNORE"
expect_lacks "RM520 interface 1 (GPS) stays with ModemManager" add "$rm520_if1" "ID_MM_PORT_IGNORE"
expect_lacks "RM520 interface 0 (QCDM) stays with ModemManager" add "$rm520_if0" "ID_MM_PORT_IGNORE"
expect_lacks "another Quectel PID's interface 3 is untouched" add "$other_if3" "ID_MM_PORT_IGNORE"
expect_lacks "another SKU's interface 3 is untouched" add "$simcom_if3" "ID_MM_PORT_IGNORE"
expect_lacks "a remove event sets nothing" remove "$rm520_if3" "ID_MM_PORT_IGNORE"
expect_lacks "the interface number stays a private (dot) property" add "$rm520_if3" "CERALIVE_USBIFNUM"
expect_has "RM520 USB device keeps its identification tag" add /sys/devices/pci0000:00/usb2/2-1 "ID_CERALIVE_MODEM=1"
expect_has "RM520 USB device keeps its SKU tag" add /sys/devices/pci0000:00/usb2/2-1 "ID_CERALIVE_MODEM_SKU=quectel-rm530n-gl"
expect_lacks "the USB device itself is not released" add /sys/devices/pci0000:00/usb2/2-1 "ID_MM_PORT_IGNORE"

if [ "$fail" -eq 0 ]; then echo "PASS: companion udev matches"; else echo "FAIL: companion udev matches"; exit 1; fi
