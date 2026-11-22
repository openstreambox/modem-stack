// D-Bus signature parsing and support checks.
//
// We keep our own tiny recursive-descent parser rather than reaching into the
// underlying library's internal `lib/signature.js`: the parsed tree drives our
// signature-aware encode/decode (below) and the tree shape is part of this seam's
// contract, not the library's. The node shape intentionally mirrors the library's
// (`{ type, child }`) so a tree the library hands us inside a decoded variant can be
// re-serialised with `signatureFromNode` without a translation step.

import { UnsupportedSignatureError } from './errors';

export interface SignatureNode {
	readonly type: string;
	readonly child: readonly SignatureNode[];
}

const CONTAINER_CLOSE: Record<string, string> = {
	'{': '}',
	'(': ')',
};

// Every basic and container type char D-Bus defines. `h` (UNIX_FD) is deliberately
// listed as *known* so the parser accepts it structurally — we reject it explicitly in
// `assertSupportedSignature` with a typed error rather than as a vague parse failure.
const KNOWN_TYPES = new Set('ybnqiuxtdsogarvhe{}()'.split(''));

// UNIX_FD: file-descriptor passing. Unsupported everywhere in this transport.
const UNSUPPORTED_TYPE = 'h';

// Throws UnsupportedSignatureError if the signature contains `h` anywhere (including
// nested inside arrays, structs, dict entries, or variants). Signatures are pure type
// strings, so a plain character scan is exact.
export function assertSupportedSignature(signature: string): void {
	const index = signature.indexOf(UNSUPPORTED_TYPE);
	if (index !== -1) {
		throw new UnsupportedSignatureError(signature, UNSUPPORTED_TYPE);
	}
}

// The D-Bus specification's limits: a signature is at most 255 bytes, with at most 32
// nested arrays and 32 nested structs (64 containers in all).
const MAX_SIGNATURE_LENGTH = 255;
const MAX_ARRAY_DEPTH = 32;
const MAX_STRUCT_DEPTH = 32;

// Types a dict entry key may have: the basic types (no `v`, no containers).
const BASIC_TYPES = new Set('ybnqiuxtdsogh'.split(''));

// Parse a full signature (which may contain several top-level complete types) into a
// flat list of nodes. Rejects what the wire format does not allow: stray or mismatched
// closers, empty structs, dict entries that are not exactly `{key value}` directly inside
// an array, the binding-only `r` and `e`, and nesting or length past the specification's
// limits (which also keeps the recursion bounded).
export function parseSignature(signature: string): SignatureNode[] {
	if (signature.length > MAX_SIGNATURE_LENGTH) {
		throw new Error(`Bad signature: longer than ${MAX_SIGNATURE_LENGTH} bytes`);
	}
	let index = 0;

	function next(): string | null {
		if (index < signature.length) {
			const char = signature[index] as string;
			index += 1;
			return char;
		}
		return null;
	}

	function parseOne(
		char: string,
		arrayDepth: number,
		structDepth: number,
		inArray: boolean,
	): SignatureNode {
		if (!KNOWN_TYPES.has(char)) {
			throw new Error(`Unknown D-Bus type "${char}" in signature "${signature}"`);
		}

		const children: SignatureNode[] = [];
		switch (char) {
			case 'a': {
				if (arrayDepth >= MAX_ARRAY_DEPTH) {
					throw new Error(
						`Bad signature "${signature}": arrays nested deeper than ${MAX_ARRAY_DEPTH}`,
					);
				}
				const element = next();
				if (element === null) {
					throw new Error(`Bad signature "${signature}": array with no element type`);
				}
				children.push(parseOne(element, arrayDepth + 1, structDepth, true));
				return { type: 'a', child: children };
			}
			case '{':
			case '(': {
				if (char === '{' && !inArray) {
					throw new Error(`Bad signature "${signature}": dict entry outside an array`);
				}
				if (structDepth >= MAX_STRUCT_DEPTH) {
					throw new Error(`Bad signature "${signature}": nested deeper than ${MAX_STRUCT_DEPTH}`);
				}
				const close = CONTAINER_CLOSE[char];
				let element = next();
				while (element !== null && element !== close) {
					children.push(parseOne(element, arrayDepth, structDepth + 1, false));
					element = next();
				}
				if (element === null) {
					throw new Error(`Bad signature "${signature}": unterminated "${char}"`);
				}
				if (char === '(' && children.length === 0) {
					throw new Error(`Bad signature "${signature}": empty struct`);
				}
				if (char === '{') {
					const key = children[0];
					if (children.length !== 2 || key === undefined || !BASIC_TYPES.has(key.type)) {
						throw new Error(`Bad signature "${signature}": dict entry must be {basic-key value}`);
					}
				}
				return { type: char, child: children };
			}
			case ')':
			case '}':
			case 'r':
			case 'e':
				throw new Error(`Bad signature "${signature}": unexpected "${char}"`);
			default:
				return { type: char, child: children };
		}
	}

	const nodes: SignatureNode[] = [];
	let char = next();
	while (char !== null) {
		nodes.push(parseOne(char, 0, 0, false));
		char = next();
	}
	return nodes;
}

// Re-serialise a single parsed node back to its signature string. Used to recover the
// inner signature of a decoded variant, whose contained type the library hands us as a
// parse tree rather than a string.
export function signatureFromNode(node: SignatureNode): string {
	switch (node.type) {
		case 'a':
			return `a${signatureFromNode(node.child[0] as SignatureNode)}`;
		case '(':
			return `(${node.child.map(signatureFromNode).join('')})`;
		case '{':
			return `{${node.child.map(signatureFromNode).join('')}}`;
		default:
			return node.type;
	}
}
