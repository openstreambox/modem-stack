import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { budget } from '../../test-support/fuzz-budget';
import { parseSignature, type SignatureNode, signatureFromNode } from '../transport/signature';

// Every character D-Bus signatures use, plus the ones the parser lists as known but the
// wire format does not define (`e`, `r`) and stray closers.
const ALPHABET = 'ybnqiuxtdsogarvh{}()e'.split('');
const signatures = fc.string({ unit: fc.constantFrom(...ALPHABET), maxLength: 40 });

const BASIC = new Set('ybnqiuxtdsogvh'.split(''));

function violations(node: SignatureNode, inArray = false): string[] {
	const found: string[] = [];
	switch (node.type) {
		case 'a':
			if (node.child.length !== 1) found.push('array without exactly one element type');
			for (const child of node.child) found.push(...violations(child, true));
			break;
		case '(':
			if (node.child.length === 0) found.push('empty struct');
			for (const child of node.child) found.push(...violations(child));
			break;
		case '{':
			if (!inArray) found.push('dict entry outside an array');
			if (node.child.length !== 2) found.push('dict entry without exactly two members');
			for (const child of node.child) found.push(...violations(child));
			break;
		default:
			if (!BASIC.has(node.type)) found.push(`type "${node.type}" is not a D-Bus type`);
	}
	return found;
}

describe('parseSignature on arbitrary signatures', () => {
	test('either throws an Error or returns a structurally valid tree that round-trips', () => {
		fc.assert(
			fc.property(signatures, (signature) => {
				let nodes: SignatureNode[];
				try {
					nodes = parseSignature(signature);
				} catch (error) {
					expect(error).toBeInstanceOf(Error);
					return;
				}
				for (const node of nodes) expect(violations(node)).toEqual([]);
				expect(nodes.map(signatureFromNode).join('')).toBe(signature);
			}),
			budget(),
		);
	});

	test('nesting far past the D-Bus limits is rejected with an Error, not a stack overflow', () => {
		for (const depth of [33, 65, 1_000, 200_000]) {
			const signature = `${'a'.repeat(depth)}y`;
			let thrown: unknown;
			try {
				parseSignature(signature);
			} catch (error) {
				thrown = error;
			}
			expect(thrown).toBeInstanceOf(Error);
			expect(thrown).not.toBeInstanceOf(RangeError);
		}
	});
});
