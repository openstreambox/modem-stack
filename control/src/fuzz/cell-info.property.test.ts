import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { budget } from '../../test-support/fuzz-budget';
import {
	type CellReading,
	compareServing,
	normalizeCellInfo,
	selectServingCell,
} from '../backend/cell-info';
import type { DecodedProps } from '../backend/managed-objects';
import { epochMillis } from '../domain';
import type { DbusVariant } from '../transport';

const PROVENANCE = { source: 'Modem.GetCellInfo', observedAt: epochMillis(1) };
const KEYS = [
	'ci',
	'cell-id',
	'tac',
	'physical-ci',
	'rsrp',
	'rsrq',
	'sinr',
	'snr',
	'band',
	'serving',
	'cell-type',
];

const variantValue = fc.oneof(
	fc.string({ maxLength: 12 }),
	fc.integer(),
	// Non-finite readings are covered next to the fix that handles them.
	fc.double({ noNaN: true, noDefaultInfinity: true }),
	fc.boolean(),
	fc.array(fc.integer(), { maxLength: 3 }),
);
const variant: fc.Arbitrary<DbusVariant> = fc.record({
	signature: fc.constantFrom('s', 'i', 'u', 'd', 'b'),
	value: variantValue as fc.Arbitrary<DbusVariant['value']>,
});
const cellDict: fc.Arbitrary<DecodedProps> = fc.array(fc.tuple(fc.constantFrom(...KEYS), variant), {
	maxLength: 8,
});

// Readings as a GetCellInfo reply produces them, so the property covers what the
// normalizer lets through rather than what the type permits.
const readings = fc
	.array(cellDict, { minLength: 1, maxLength: 6 })
	.map((dicts) => normalizeCellInfo(dicts, PROVENANCE) as CellReading[]);

describe('cell-info normalization', () => {
	test('never throws and keeps the pinned types', () => {
		fc.assert(
			fc.property(fc.array(cellDict, { maxLength: 6 }), (dicts) => {
				for (const reading of normalizeCellInfo(dicts, PROVENANCE)) {
					expect(typeof reading.serving).toBe('boolean');
					for (const key of ['pci', 'rsrp', 'rsrq', 'sinr'] as const) {
						const value = reading[key];
						if (value !== undefined) expect(typeof value).toBe('number');
					}
				}
			}),
			budget(),
		);
	});

	test('the serving-cell winner does not depend on input order', () => {
		fc.assert(
			fc.property(readings, fc.infiniteStream(fc.nat()), (cells, stream) => {
				const shuffled = [...cells];
				const picks = stream[Symbol.iterator]();
				for (let i = shuffled.length - 1; i > 0; i -= 1) {
					const j = (picks.next().value as number) % (i + 1);
					[shuffled[i], shuffled[j]] = [shuffled[j] as CellReading, shuffled[i] as CellReading];
				}
				expect(JSON.stringify(selectServingCell(shuffled))).toBe(
					JSON.stringify(selectServingCell(cells)),
				);
			}),
			budget(),
		);
	});

	test('compareServing is antisymmetric', () => {
		fc.assert(
			fc.property(readings, (cells) => {
				for (const a of cells) {
					for (const b of cells) {
						expect(Math.sign(compareServing(a, b)) + Math.sign(compareServing(b, a))).toBe(0);
					}
				}
			}),
			budget(),
		);
	});
});
