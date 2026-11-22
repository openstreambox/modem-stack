import { describe, expect, test } from 'bun:test';
import { parseSignature, signatureFromNode } from './signature';

const roundTrip = (signature: string) => parseSignature(signature).map(signatureFromNode).join('');

describe('parseSignature accepts the signatures ModemManager uses', () => {
	test.each([
		'',
		'u',
		'ss',
		'a{sv}',
		'aa{sv}',
		'a{oa{sa{sv}}}',
		'(uu)',
		'a(ss)',
		'ay',
		'v',
		'a{uv}',
	])('%p', (signature) => {
		expect(roundTrip(signature)).toBe(signature);
	});

	test('nesting up to the specification limits', () => {
		expect(roundTrip(`${'a'.repeat(32)}y`)).toBe(`${'a'.repeat(32)}y`);
		expect(roundTrip(`${'('.repeat(32)}y${')'.repeat(32)}`)).toBe(
			`${'('.repeat(32)}y${')'.repeat(32)}`,
		);
	});
});

describe('parseSignature rejects what the wire format does not allow', () => {
	test.each([
		['a stray struct closer', ')'],
		['a stray dict closer', '}'],
		['a mismatched closer', '(s}'],
		['an empty struct', '()'],
		['a dict entry outside an array', '{sv}'],
		['a dict entry with one member', 'a{s}'],
		['a dict entry with three members', 'a{ssv}'],
		['a dict entry with a container key', 'a{avs}'],
		['a binding-only struct marker', 'r'],
		['a binding-only dict marker', 'e'],
		['an array with no element type', 'a'],
		['an unterminated struct', '(ss'],
		['arrays nested past 32', `${'a'.repeat(33)}y`],
		['structs nested past 32', `${'('.repeat(33)}y${')'.repeat(33)}`],
		['a signature past 255 bytes', 'y'.repeat(256)],
	])('%s', (_name, signature) => {
		expect(() => parseSignature(signature)).toThrow(Error);
	});

	test('a very deep signature is an error, not a stack overflow', () => {
		let thrown: unknown;
		try {
			parseSignature(`${'a'.repeat(200_000)}y`);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).not.toBeInstanceOf(RangeError);
	});
});
