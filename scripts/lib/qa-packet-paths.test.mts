import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
	parseQaPacketArguments,
	parseQaPacketDiffArguments,
	prepareDiffDirectory,
	preparePacketDirectories,
	readFixedPacket,
	resolvePacketPaths,
	validateHeadSha,
} from './qa-packet-paths.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validSha = 'a'.repeat(40);
const temporaryBase = realpathSync(tmpdir());
const scratchRoots: string[] = [];

function makeScratch(prefix: string) {
	const root = mkdtempSync(path.join(temporaryBase, prefix));
	const relative = path.relative(temporaryBase, realpathSync(root));
	if (!relative.startsWith(prefix) || relative.includes(path.sep) || path.isAbsolute(relative)) {
		throw new Error('test setup produced an unsafe scratch root');
	}
	scratchRoots.push(root);
	return root;
}

afterEach(() => {
	for (const root of scratchRoots.splice(0)) {
		const resolved = realpathSync(root);
		const relative = path.relative(temporaryBase, resolved);
		if (!relative.startsWith('gftb-qa-') || relative.includes(path.sep) || path.isAbsolute(relative)) {
			throw new Error('refusing unsafe test scratch cleanup');
		}
		rmSync(resolved, { recursive: true });
	}
});

describe('qa-packet destructive-path contract', () => {
	it('rejects every arbitrary --out spelling before filesystem work', () => {
		const container = makeScratch('gftb-qa-out-contract-');
		const sentinel = path.join(container, 'outside-sentinel');
		writeFileSync(sentinel, 'must survive', 'utf8');

		for (const value of ['/absolute/packet', '..', '.', '', repoRoot, '/Users/example']) {
			expect(() => parseQaPacketArguments(['--port', '3355', '--out', value]), value).toThrow(
				'unknown argument --out',
			);
			expect(readFileSync(sentinel, 'utf8'), value).toBe('must survive');
		}
	});

	it('accepts only an exact lowercase 40-hex SHA', () => {
		expect(validateHeadSha(validSha)).toBe(validSha);
		for (const value of ['', '.', '..', 'a'.repeat(39), 'a'.repeat(41), 'A'.repeat(40), `${'a'.repeat(39)}/`]) {
			expect(() => validateHeadSha(value), value).toThrow('exactly 40 lowercase hexadecimal');
		}
	});

	it('constructs a strict fixed child of qa-packet and never the repo or base itself', () => {
		const resolved = resolvePacketPaths(repoRoot, validSha);
		expect(resolved.packetBase).toBe(path.join(repoRoot, 'qa-packet'));
		expect(resolved.packetRoot).toBe(path.join(repoRoot, 'qa-packet', validSha));
		expect(resolved.packetRoot).not.toBe(repoRoot);
		expect(resolved.packetRoot).not.toBe(resolved.packetBase);
		expect(path.relative(resolved.packetBase, resolved.packetRoot)).toBe(validSha);
	});

	it('fails on an existing packet root and preserves an outside sentinel', () => {
		const container = makeScratch('gftb-qa-existing-contract-');
		const syntheticRepo = path.join(container, 'repo');
		const sentinel = path.join(container, 'outside-sentinel');
		mkdirSync(syntheticRepo);
		writeFileSync(sentinel, 'must survive', 'utf8');

		const created = preparePacketDirectories(syntheticRepo, validSha);
		expect(() => preparePacketDirectories(syntheticRepo, validSha)).toThrow('packet already exists');
		expect(readFileSync(sentinel, 'utf8')).toBe('must survive');
		expect(created.packetRoot).toBe(path.join(syntheticRepo, 'qa-packet', validSha));
	});

	it('rejects a symlinked fixed base without touching its target', () => {
		const container = makeScratch('gftb-qa-symlink-contract-');
		const syntheticRepo = path.join(container, 'repo');
		const outside = path.join(container, 'outside');
		const sentinel = path.join(outside, 'sentinel');
		mkdirSync(syntheticRepo);
		mkdirSync(outside);
		writeFileSync(sentinel, 'must survive', 'utf8');
		symlinkSync(outside, path.join(syntheticRepo, 'qa-packet'), 'dir');

		expect(() => preparePacketDirectories(syntheticRepo, validSha)).toThrow('not a real directory');
		expect(readFileSync(sentinel, 'utf8')).toBe('must survive');
	});

	it('keeps recursive deletion and caller-selected output roots out of the runner', () => {
		const runner = readFileSync(path.join(repoRoot, 'scripts/qa-packet.mjs'), 'utf8');
		expect(runner).not.toContain('rmSync');
		expect(runner).not.toContain('options.out');
		expect(runner).not.toContain("case '--out'");
		expect(runner).toContain('preparePacketDirectories');
	});
});

describe('qa-packet-diff destructive-path contract', () => {
	const candidateSha = 'b'.repeat(40);

	const writePacket = (syntheticRepo: string, sha: string, manifestSha = sha) => {
		const packetRoot = path.join(syntheticRepo, 'qa-packet', sha);
		mkdirSync(packetRoot, { recursive: true });
		writeFileSync(path.join(packetRoot, 'manifest.json'), JSON.stringify({ sha: manifestSha, shots: [] }), 'utf8');
		return packetRoot;
	};

	it('rejects --out values and leaves an outside sentinel untouched', () => {
		const container = makeScratch('gftb-qa-diff-out-contract-');
		const sentinel = path.join(container, 'outside-sentinel');
		writeFileSync(sentinel, 'must survive', 'utf8');
		for (const value of ['/absolute/diff', '..', '.', '', repoRoot, '/Users/example']) {
			expect(
				() => parseQaPacketDiffArguments(['qa-packet/a', 'qa-packet/b', '--out', value], 8),
				value,
			).toThrow('unknown argument --out');
			expect(readFileSync(sentinel, 'utf8'), value).toBe('must survive');
		}
	});

	it('accepts only fixed packet roots with a matching 40-hex manifest SHA', () => {
		const container = makeScratch('gftb-qa-diff-input-contract-');
		const syntheticRepo = path.join(container, 'repo');
		mkdirSync(syntheticRepo);
		const packetRoot = writePacket(syntheticRepo, validSha);
		expect(readFixedPacket(syntheticRepo, packetRoot).manifest.sha).toBe(validSha);

		for (const value of ['/outside/packet', '..', '.', '', syntheticRepo, '/Users/example']) {
			expect(() => readFixedPacket(syntheticRepo, value), value).toThrow();
		}
		const mismatched = writePacket(syntheticRepo, candidateSha, validSha);
		expect(() => readFixedPacket(syntheticRepo, mismatched)).toThrow('manifest SHA does not match');
	});

	it('rejects manifest-selected traversal before any image read or diff write', () => {
		const container = makeScratch('gftb-qa-diff-manifest-contract-');
		const syntheticRepo = path.join(container, 'repo');
		const sentinel = path.join(container, 'outside-sentinel');
		mkdirSync(syntheticRepo);
		writeFileSync(sentinel, 'must survive', 'utf8');
		const packetRoot = writePacket(syntheticRepo, validSha);
		mkdirSync(path.join(packetRoot, 'shots'));
		writeFileSync(
			path.join(packetRoot, 'manifest.json'),
			JSON.stringify({
				sha: validSha,
				shots: [{ id: '../../outside-sentinel', file: '../../outside-sentinel' }],
			}),
			'utf8',
		);

		expect(() => readFixedPacket(syntheticRepo, packetRoot)).toThrow('every shot id');
		expect(readFileSync(sentinel, 'utf8')).toBe('must survive');
	});

	it('derives one fixed diff directory, fails if it exists, and preserves an outside sentinel', () => {
		const container = makeScratch('gftb-qa-diff-existing-contract-');
		const syntheticRepo = path.join(container, 'repo');
		const sentinel = path.join(container, 'outside-sentinel');
		mkdirSync(syntheticRepo);
		writeFileSync(sentinel, 'must survive', 'utf8');
		writePacket(syntheticRepo, validSha);
		writePacket(syntheticRepo, candidateSha);

		const output = prepareDiffDirectory(syntheticRepo, validSha, candidateSha);
		expect(output).toBe(path.join(syntheticRepo, 'qa-packet', 'diff', 'aaaaaaaaaaaa__bbbbbbbbbbbb'));
		expect(() => prepareDiffDirectory(syntheticRepo, validSha, candidateSha)).toThrow('output already exists');
		expect(readFileSync(sentinel, 'utf8')).toBe('must survive');
	});

	it('keeps recursive deletion and caller-selected output roots out of the diff runner', () => {
		const runner = readFileSync(path.join(repoRoot, 'scripts/qa-packet-diff.mjs'), 'utf8');
		expect(runner).not.toContain('rmSync');
		expect(runner).not.toContain('options.out');
		expect(runner).not.toContain("case '--out'");
		expect(runner).toContain('prepareDiffDirectory');
	});
});
