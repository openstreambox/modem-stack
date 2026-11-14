import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';

/** Open an owner-only regular file without following a symlink. */
export async function openPrivateFile(path: string, flags: number, mode = 0o600) {
	const file = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, mode);
	try {
		if (!(await file.stat()).isFile()) throw new Error('Private target must be a regular file');
		await file.chmod(mode);
		return file;
	} catch (error) {
		await file.close();
		throw error;
	}
}

/** Replace using an exclusive sibling; never write through an old temporary name. */
export async function replacePrivateFile(path: string, contents: string): Promise<void> {
	await unlink(`${path}.tmp`).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== 'ENOENT') throw error;
	});
	const temp = `${path}.${randomUUID()}.tmp`;
	const file = await openPrivateFile(
		temp,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
	);
	try {
		try {
			await file.writeFile(contents);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temp, path);
	} finally {
		await unlink(temp).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') throw error;
		});
	}
}
