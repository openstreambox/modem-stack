import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPrivateFile, replacePrivateFile } from './private-file';

for (const mask of [0o022, 0o777]) {
	test(`private descriptors are 0600 before bytes with umask ${mask.toString(8)}`, async () => {
		const dir = await mkdtemp(join(tmpdir(), 'private-file-'));
		const previous = process.umask(mask);
		try {
			const path = join(dir, 'state');
			for (const existing of [false, true]) {
				if (existing) {
					await chmod(path, 0o644);
				}
				const file = await openPrivateFile(path, constants.O_WRONLY | constants.O_CREAT);
				try {
					expect((await file.stat()).mode & 0o777).toBe(0o600);
					await file.writeFile('synthetic');
				} finally {
					await file.close();
				}
				expect((await stat(path)).mode & 0o777).toBe(0o600);
			}
			await replacePrivateFile(path, 'replacement');
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			expect(await readFile(path, 'utf8')).toBe('replacement');
		} finally {
			process.umask(previous);
			await rm(dir, { recursive: true, force: true });
		}
	});
}

test('private opens reject symlinks without changing the target', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'private-link-'));
	try {
		const target = join(dir, 'target');
		await writeFile(target, 'untouched', { mode: 0o644 });
		await symlink(target, join(dir, 'link'));
		await expect(openPrivateFile(join(dir, 'link'), constants.O_WRONLY)).rejects.toMatchObject({
			code: 'ELOOP',
		});
		expect(await readFile(target, 'utf8')).toBe('untouched');
		expect((await stat(target)).mode & 0o777).toBe(0o644);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test('replacement removes legacy temporary files and symlinks without following them', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'private-legacy-'));
	try {
		const path = join(dir, 'state');
		const target = join(dir, 'target');
		await writeFile(target, 'untouched');
		for (const link of [false, true]) {
			if (link) await symlink(target, `${path}.tmp`);
			else await writeFile(`${path}.tmp`, 'legacy secret');
			await replacePrivateFile(path, 'new');
			await expect(lstat(`${path}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' });
			expect(await readFile(target, 'utf8')).toBe('untouched');
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

for (const flags of ['O_WRONLY', 'O_RDWR']) {
	test(`private opens reject FIFOs promptly with ${flags}`, async () => {
		const dir = await mkdtemp(join(tmpdir(), 'private-fifo-'));
		try {
			const path = join(dir, 'fifo');
			expect(spawnSync('mkfifo', [path]).status).toBe(0);
			const source = `import { openPrivateFile } from ${JSON.stringify(join(import.meta.dir, 'private-file.ts'))};
    import { constants } from 'node:fs';
    try { const file = await openPrivateFile(${JSON.stringify(path)}, constants.${flags}); await file.close(); process.exit(2); }
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
