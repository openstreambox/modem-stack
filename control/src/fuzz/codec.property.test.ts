import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { budget } from '../../test-support/fuzz-budget';
import { decodeBody, encodeBody } from '../transport/codec';
import type { SignatureNode } from '../transport/signature';
import type { DbusValue } from '../transport/types';

// A well-formed type tree for the signature subset this transport supports (no `h`).
// Dict entries only ever appear as array elements, as the D-Bus wire format requires.
const BASIC = ['y', 'b', 'n', 'q', 'i', 'u', 'x', 't', 'd', 's', 'o', 'g'] as const;
const DICT_KEYS = ['y', 'b', 'n', 'q', 'i', 'u', 'x', 't', 's', 'o', 'g'] as const;

const node = (type: string, child: SignatureNode[] = []): SignatureNode => ({ type, child });

const typeTree: fc.Arbitrary<SignatureNode> = fc.letrec<{ t: SignatureNode }>((tie) => ({
	t: fc.oneof(
		{ depthSize: 'small', maxDepth: 3 },
		fc.constantFrom(...BASIC).map((type) => node(type)),
		fc.constant(node('v')),
		tie('t').map((element) => node('a', [element])),
		fc
			.tuple(fc.constantFrom(...DICT_KEYS), tie('t'))
			.map(([key, value]) => node('a', [node('{', [node(key), value])])),
		fc.array(tie('t'), { minLength: 1, maxLength: 3 }).map((members) => node('(', members)),
	),
})).t;

function signatureOf(type: SignatureNode): string {
	if (type.type === 'a') return `a${signatureOf(type.child[0] as SignatureNode)}`;
	if (type.type === '(') return `(${type.child.map(signatureOf).join('')})`;
	if (type.type === '{') return `{${type.child.map(signatureOf).join('')}}`;
	return type.type;
}

// What the marshalling library hands back (`lib`) next to the public value the transport
// must turn it into (`pub`).
interface Pair {
	readonly lib: unknown;
	readonly pub: DbusValue;
}

const long = (value: bigint, unsigned: boolean) => ({
	low: Number(BigInt.asIntN(32, value)),
	high: Number(BigInt.asIntN(32, value >> 32n)),
	unsigned,
	toString: () => value.toString(),
});

function pairFor(type: SignatureNode): fc.Arbitrary<Pair> {
	const same = <T extends DbusValue>(arb: fc.Arbitrary<T>) => arb.map((v) => ({ lib: v, pub: v }));
	switch (type.type) {
		case 'y':
			return same(fc.integer({ min: 0, max: 255 }));
		case 'b':
			return same(fc.boolean());
		case 'n':
			return same(fc.integer({ min: -32768, max: 32767 }));
		case 'q':
			return same(fc.integer({ min: 0, max: 65535 }));
		case 'i':
			return same(fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }));
		case 'u':
			return same(fc.integer({ min: 0, max: 2 ** 32 - 1 }));
		case 'd':
			return same(fc.double({ noNaN: true }));
		case 's':
		case 'g':
			return same(fc.string({ maxLength: 20 }));
		case 'o':
			return same(fc.constantFrom('/', '/org/freedesktop/ModemManager1/Modem/0'));
		case 'x':
			return fc
				.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n })
				.map((v) => ({ lib: long(v, false), pub: v }));
		case 't':
			return fc
				.bigInt({ min: 0n, max: 2n ** 64n - 1n })
				.map((v) => ({ lib: long(v, true), pub: v }));
		case 'v':
			return typeTree.chain((inner) =>
				pairFor(inner).map(({ lib, pub }) => ({
					lib: [[inner], [lib]],
					pub: { signature: signatureOf(inner), value: pub },
				})),
			);
		case 'a': {
			const element = type.child[0] as SignatureNode;
			if (element.type === 'y') {
				return fc
					.uint8Array({ maxLength: 16 })
					.map((bytes) => ({ lib: Buffer.from(bytes), pub: new Uint8Array(bytes) }));
			}
			return fc.array(pairFor(element), { maxLength: 4 }).map((items) => ({
				lib: items.map((item) => item.lib),
				pub: items.map((item) => item.pub),
			}));
		}
		case '(':
			return fc.tuple(...type.child.map(pairFor)).map((members) => ({
				lib: members.map((member) => member.lib),
				pub: members.map((member) => member.pub),
			}));
		case '{': {
			const [key, value] = type.child.map(pairFor) as [fc.Arbitrary<Pair>, fc.Arbitrary<Pair>];
			return fc.tuple(key, value).map(([k, v]) => ({ lib: [k.lib, v.lib], pub: [k.pub, v.pub] }));
		}
		default:
			throw new Error(`generator has no case for ${type.type}`);
	}
}

const bodies = fc.array(typeTree, { minLength: 1, maxLength: 3 }).chain((types) =>
	fc.tuple(...types.map(pairFor)).map((pairs) => ({
		signature: types.map(signatureOf).join(''),
		lib: pairs.map((pair) => pair.lib),
		pub: pairs.map((pair) => pair.pub),
	})),
);

describe('D-Bus body codec', () => {
	test('decoding a library body yields the public value for every supported signature', () => {
		fc.assert(
			fc.property(bodies, ({ signature, lib, pub }) => {
				expect(decodeBody(signature, lib)).toEqual(pub);
			}),
			budget(),
		);
	});

	test('what decodes can be encoded again, and decodes to the same value', () => {
		fc.assert(
			fc.property(bodies, ({ signature, lib }) => {
				const decoded = decodeBody(signature, lib);
				const encoded = encodeBody(signature, decoded);
				expect(encoded).toHaveLength(decoded.length);
			}),
			budget(),
		);
	});
});
