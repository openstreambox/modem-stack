#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$HERE/../ModemManager/debian/patches/0001-fm350gl-forward-port-rndis-bearer-and-modes.patch"
CREG_PATCH_NAME="0004-modem-helpers-accept-two-digit-act-in-creg.patch"
CREG_PATCH="$HERE/../ModemManager/debian/patches/$CREG_PATCH_NAME"
SERIES="$HERE/../ModemManager/debian/patches/series"

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

grep -Fq '+enabling_modem_init (MMBroadbandModem' "$PATCH" ||
	fail 'FM350 patch does not override the first-enable modem initialization'
grep -Fq '+                                   "Z0",' "$PATCH" ||
	fail 'FM350 first-enable override does not send the hardware-proven Z0 command'
grep -Fq '+    broadband_modem_class->enabling_modem_init = enabling_modem_init;' "$PATCH" ||
	fail 'FM350 class does not install the first-enable override'

if grep -Fq '+                                   "Z",' "$PATCH"; then
	fail 'FM350 override regressed to Z, which this firmware rejects with CME 59'
fi

grep -Fq '+    info = mm_fm350gl_parse_cgcontrdp_response (response, ctx->cid, &error);' "$PATCH" ||
	fail 'FM350 bearer does not parse +CGCONTRDP with its own lenient parser'
if grep -Fq '+    if (!response || !mm_3gpp_parse_cgcontrdp_response' "$PATCH"; then
	fail 'FM350 bearer regressed to the generic +CGCONTRDP parser, which rejects an empty bearer id'
fi
grep -Fq '+    g_test_add_func ("/MM/fm350gl/cgcontrdp/tmobile", test_cgcontrdp_tmobile);' "$PATCH" ||
	fail 'FM350 patch lost the empty-bearer-id +CGCONTRDP regression test'

grep -Fxq "$CREG_PATCH_NAME" "$SERIES" ||
	fail 'series lost the two-digit AcT +CREG/+CGREG/+CEREG fix the FM350 needs on 5G SA'
[ -f "$CREG_PATCH" ] || fail "missing $CREG_PATCH_NAME"
# The AcT capture of each of these patterns must accept 10 to 13 (11 = NR on a 5GCN), and only
# those: an open-ended [0-9]+ reads padded cell ids and unquoted RACs as an AcT.
for idx in 5 6 7 9 10 11; do
	line=$(grep -E "^\+    \[$idx\] = " "$CREG_PATCH") ||
		fail "registration patch no longer rewrites creg_regex[$idx]"
	case "$line" in
	*'1[0-3]'*) ;;
	*) fail "creg_regex[$idx] in the registration patch does not accept AcT 10 to 13" ;;
	esac
	case "$line" in
	*'[0-9]+'*) fail "creg_regex[$idx] in the registration patch takes an open-ended number" ;;
	esac
done
for t in test_creg_5gsa_registered_after_enable_sequence test_creg_5gsa_radio_on_sequence \
	test_creg_5gsa_urcs_both_orders test_creg_two_digit_act_no_collision; do
	grep -Fq "+    g_test_suite_add (suite, TESTCASE ($t, reg_data));" "$CREG_PATCH" ||
		fail "registration patch lost its replay test $t"
done

printf 'PASS: FM350 patch preserves the hardware-required Z0 first-enable override\n'

printf 'PASS: FM350 patch keeps the lenient +CGCONTRDP parser and its regression test\n'

printf 'PASS: series keeps the two-digit AcT registration fix, its replay and collision tests\n'
