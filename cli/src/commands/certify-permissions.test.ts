import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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

for (const kind of ['fifo', 'device']) {
	test(`certification refuses a ${kind} promptly`, async () => {
		const dir = await mkdtemp(join(tmpdir(), 'certify-special-'));
		try {
			const path = kind === 'fifo' ? join(dir, 'fifo') : '/dev/null';
			if (kind === 'fifo') expect(spawnSync('mkfifo', [path]).status).toBe(0);
			const source = `import { certifyDepsFromContext } from ${JSON.stringify(join(import.meta.dir, 'certify.ts'))};
    const deps = certifyDepsFromContext({ now: Date.now }, {slot:'test', synthetic:true});
    try { await deps.writeBundle(${JSON.stringify(path)}, '{}'); process.exit(2); }
    catch (error) { if (error.code !== 'ENXIO' && !error.message.includes('regular file')) throw error; }`;
			const result = spawnSync(process.execPath, ['--eval', source], {
				timeout: 3000,
				encoding: 'utf8',
			});
			expect(result.error).toBeUndefined();
			expect(result.status).toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
}
