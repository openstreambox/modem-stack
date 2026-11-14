import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StackContext } from '../context';
import { certifyDepsFromContext } from './certify';

test('certification output is owner-only on creation and replacement', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'certify-private-'));
	const mask = process.umask(0o022);
	try {
		const output = join(dir, 'bundle.json');
		const deps = certifyDepsFromContext({ now: Date.now } as StackContext, {
			slot: 'test',
			synthetic: true,
		});
		await deps.writeBundle(output, '{}');
		expect((await stat(output)).mode & 0o777).toBe(0o600);
		await chmod(output, 0o644);
		await deps.writeBundle(output, '{}');
		expect((await stat(output)).mode & 0o777).toBe(0o600);
	} finally {
		process.umask(mask);
		await rm(dir, { recursive: true, force: true });
	}
});
