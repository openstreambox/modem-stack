import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { budget } from '../../test-support/fuzz-budget';
import { fixtureContext, MM_FIXTURE } from '../../test-support/observation-fixtures';
import { parseMmVersion } from '../backend/features';
import { parseNmVersion } from '../backend/nm-auto-apn';
import { parseTerse } from '../backend/nmcli-runner';
import { parseProcNetDev } from '../backend/usage/proc-net-dev';
import { parseUdevDatabase } from '../backend/usb-enumerator';
import {
	decode3gppLacCi,
	decodeMmAccessTechnologies,
	decodeMmState,
	decodeRegistrationState,
	lacCiOperatorCode,
} from '../domain';
import {
	parseHilinkCapabilities,
	parseHilinkDataCapability,
	parseHilinkSession,
	parseHilinkSignal,
	parseHilinkUserState,
	parseUfiSignal,
	parseZteSignal,
} from '../hardware/router-parsers';
import { parseNmeaFix } from '../location/nmea';
import { normalizeModemManagerObservation, type RawFieldValue } from '../observations';
import { flattenXmlBody, parseJsonRecord } from '../observations/raw';
import { parseSmsListOutput, parseSmsRecordOutput } from '../sms/mmcli-parse';
import { parseUsbDevices } from '../usb-mode/usb-devices-parse';

const text = fc.oneof(
	fc.string({ maxLength: 400 }),
	fc.string({ unit: 'binary', maxLength: 200 }),
	fc.stringMatching(/^[<>/A-Za-z0-9=,.:"'\s{}[\]-]{0,300}$/),
);
const numbers = fc.oneof(
	fc.integer(),
	fc.double({ noDefaultInfinity: false, noNaN: false }),
	fc.constantFrom(Number.MAX_SAFE_INTEGER, -1, 0, 2 ** 31, 2 ** 32 - 1, 2 ** 53, Number.NaN),
);

describe('text parsers never throw on arbitrary input', () => {
	test.each([
		['parseMmVersion', (s: string) => parseMmVersion(s)],
		['parseNmVersion', (s: string) => parseNmVersion(s)],
		['parseTerse', (s: string) => parseTerse(s)],
		['parseProcNetDev', (s: string) => parseProcNetDev(s)],
		['parseUdevDatabase', (s: string) => parseUdevDatabase(s)],
		['parseUsbDevices', (s: string) => parseUsbDevices(s)],
		['parseNmeaFix', (s: string) => parseNmeaFix(s)],
		['parseSmsListOutput', (s: string) => parseSmsListOutput(s)],
		['parseSmsRecordOutput', (s: string) => parseSmsRecordOutput(s)],
		['parseHilinkSession', (s: string) => parseHilinkSession(s)],
		['parseHilinkUserState', (s: string) => parseHilinkUserState(s)],
		['parseHilinkDataCapability', (s: string) => parseHilinkDataCapability(s)],
		['parseHilinkCapabilities', (s: string) => parseHilinkCapabilities({ netModeList: s })],
		['parseHilinkSignal', (s: string) => parseHilinkSignal({ status: s, signal: s })],
		['parseZteSignal', (s: string) => parseZteSignal(s)],
		['parseUfiSignal', (s: string) => parseUfiSignal({ sysinfo: s, overview: s, status: s })],
		['parseJsonRecord', (s: string) => parseJsonRecord(s)],
		['flattenXmlBody', (s: string) => flattenXmlBody(s, 'body')],
		['decode3gppLacCi', (s: string) => decode3gppLacCi(s)],
	])('%s', (_name, parse) => {
		fc.assert(
			fc.property(text, (input) => {
				parse(input);
			}),
			budget(),
		);
	});
});

describe('mmcli SMS parsing stays content-free', () => {
	test('a refusal never echoes message content', () => {
		const secret = 'S3CRET-OTP-424242';
		fc.assert(
			fc.property(fc.array(text, { maxLength: 6 }), fc.nat(5), (lines, at) => {
				const body = [...lines];
				body.splice(Math.min(at, body.length), 0, `modem.messaging.sms.value[1] : ${secret}`);
				for (const parsed of [
					parseSmsListOutput(body.join('\n')),
					parseSmsRecordOutput(body.join('\n')),
				]) {
					if (!parsed.ok) {
						expect(parsed.reason).not.toContain(secret);
						expect(parsed.detail).not.toContain(secret);
					}
				}
			}),
			budget(),
		);
	});
});

describe('numeric decoders are total', () => {
	test('MM enum decoders accept any number', () => {
		fc.assert(
			fc.property(numbers, (n) => {
				decodeMmAccessTechnologies(n);
				expect(typeof decodeMmState(n)).toBe('string');
				expect(typeof decodeRegistrationState(n)).toBe('string');
			}),
			budget(),
		);
	});
});

// Mostly five-token strings, since anything else is rejected before the tokens matter.
const lacCiText = fc.oneof(
	text,
	fc
		.array(fc.oneof(fc.stringMatching(/^[0-9A-Fa-f]{0,4}$/), fc.string({ maxLength: 4 })), {
			minLength: 5,
			maxLength: 5,
		})
		.map((tokens) => tokens.join(',')),
);

describe('3GPP location context', () => {
	test('an accepted value has the shape MM prints', () => {
		fc.assert(
			fc.property(lacCiText, (input) => {
				const decoded = decode3gppLacCi(input);
				if (decoded === undefined) return;
				expect(decoded.mcc).toMatch(/^\d{3}$/);
				expect(decoded.mnc).toMatch(/^\d{2,3}$/);
				expect(decoded.cellId).toMatch(/^[0-9A-Fa-f]{1,16}$/);
				expect(decoded.locationAreaCode).toMatch(/^[0-9A-Fa-f]{0,16}$/);
				expect(decoded.trackingAreaCode).toMatch(/^[0-9A-Fa-f]{0,16}$/);
			}),
			budget(),
		);
	});

	test('an accepted value reproduces its source tokens', () => {
		fc.assert(
			fc.property(lacCiText, (input) => {
				const decoded = decode3gppLacCi(input);
				if (decoded === undefined) return;
				expect(decoded.mcc).not.toBe('');
				expect(decoded.mnc).not.toBe('');
				expect(decoded.cellId).not.toBe('');
				expect(
					[
						decoded.mcc,
						decoded.mnc,
						decoded.locationAreaCode,
						decoded.cellId,
						decoded.trackingAreaCode,
					].join(','),
				).toBe(
					input
						.trim()
						.split(',')
						.map((token) => token.trim())
						.join(','),
				);
				expect(lacCiOperatorCode(decoded)).toBe(`${decoded.mcc}${decoded.mnc}`);
			}),
			budget(),
		);
	});
});

describe('GNSS fixes', () => {
	test('a returned fix is a position on Earth', () => {
		fc.assert(
			fc.property(text, (input) => {
				const fix = parseNmeaFix(input);
				if (fix === undefined) return;
				expect(Math.abs(fix.latitude)).toBeLessThanOrEqual(90);
				expect(Math.abs(fix.longitude)).toBeLessThanOrEqual(180);
				if (fix.altitude !== undefined) expect(Number.isFinite(fix.altitude)).toBe(true);
			}),
			budget(),
		);
	});
});

describe('byte counters', () => {
	test('/proc/net/dev counters are non-negative safe numbers', () => {
		fc.assert(
			fc.property(text, (input) => {
				for (const value of parseProcNetDev(input).values()) {
					expect(Number.isFinite(value)).toBe(true);
					expect(value).toBeGreaterThanOrEqual(0);
				}
			}),
			budget(),
		);
	});
});

describe('router signal models carry only finite readings', () => {
	const metrics = (model: Record<string, unknown>) =>
		['bars', 'max_bars', 'dbm', 'rsrp', 'rsrq', 'snr', 'sinr'].map(
			(key) => model[key] as { state: string; value?: number },
		);
	test('hilink, zte and ufi', () => {
		const json = fc.oneof(
			fc.json(),
			fc
				.dictionary(fc.string({ maxLength: 12 }), fc.oneof(fc.string({ maxLength: 12 }), numbers))
				.map((d) => JSON.stringify(d)),
			text,
		);
		fc.assert(
			fc.property(text, json, (xml, body) => {
				for (const model of [
					parseHilinkSignal({ status: xml, signal: xml }),
					parseZteSignal(body),
					parseUfiSignal({ sysinfo: body, overview: body, status: body }),
				]) {
					for (const metric of metrics(model as unknown as Record<string, unknown>)) {
						if (metric.state === 'known') expect(Number.isFinite(metric.value)).toBe(true);
					}
				}
			}),
			budget(),
		);
	});
});

describe('ModemManager observation normalization', () => {
	const rawValue: fc.Arbitrary<RawFieldValue> = fc.letrec<{ v: RawFieldValue }>((tie) => ({
		v: fc.oneof(
			{ depthSize: 'small' },
			fc.string({ maxLength: 40 }),
			numbers,
			fc.boolean(),
			fc.constant(null),
			fc.array(tie('v'), { maxLength: 4 }),
		),
	})).v;
	const sections = ['modem', 'modem3gpp', 'sim', 'signal', 'location'] as const;

	test('arbitrary property values never throw and always serialize', () => {
		fc.assert(
			fc.property(
				fc.record(
					Object.fromEntries(
						sections.map((section) => {
							const known = Object.keys(MM_FIXTURE[section] ?? {});
							return [
								section,
								fc.option(
									fc.dictionary(
										fc.oneof(
											fc.constantFrom(...known, '3gpp-lac-ci'),
											fc.string({ maxLength: 12 }),
										),
										rawValue,
										{ maxKeys: 12 },
									),
									{ nil: undefined },
								),
							];
						}),
					),
				),
				(input) => {
					const envelope = normalizeModemManagerObservation(input, fixtureContext());
					JSON.stringify(envelope);
				},
			),
			budget(),
		);
	});
});
