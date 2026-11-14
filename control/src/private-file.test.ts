import { expect, test } from 'bun:test';
import { constants } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
