// The tailnet probe URL's path into the build: the status command
// (scripts/bazel/workspace-status.sh) and the two stamped readers
// (scripts/bazel/build-metadata.mjs) that //:build and //:scanned_build use.
// Fixture hosts only; no real probe URL is set anywhere.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
	INVALID_MARKER,
	MALFORMED_PROBE_URL_MESSAGE,
	readBuildMetadata,
	readTailnetProbeUrl,
} from '../bazel/build-metadata.mjs';
import { tailnetProbeHost } from './leak-scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const STATUS_SCRIPT = resolve(here, '../bazel/workspace-status.sh');
const GOOD = 'https://gftb-probe.example.ts.net/probe.svg';
const dirs: string[] = [];

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runStatus(extra: Record<string, string>) {
	const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...extra };
	const done = spawnSync('bash', [STATUS_SCRIPT], { env, encoding: 'utf8' });
	const stamped = new Map<string, string>();
	for (const line of done.stdout.split('\n')) {
		const at = line.indexOf(' ');
		if (at > 0) stamped.set(line.slice(0, at), line.slice(at + 1));
	}
	return { status: done.status, stdout: done.stdout, stderr: done.stderr, stamped };
}

function statusFile(lines: string[]) {
	const dir = mkdtempSync(join(tmpdir(), 'probe-stamp-'));
	dirs.push(dir);
	const file = join(dir, 'stable-status.txt');
	writeFileSync(file, lines.join('\n') + '\n');
	return { BAZEL_STABLE_STATUS_FILE: file };
}

describe('workspace-status.sh stamps the probe URL', () => {
	it('stamps the empty marker when unset and a valid URL as given', () => {
		expect(runStatus({}).stamped.get('STABLE_BUILD_TAILNET_PROBE_URL')).toBe('__EMPTY__');
		const ok = runStatus({ PUBLIC_TAILNET_PROBE_URL: GOOD });
		expect(ok.status).toBe(0);
		expect(ok.stamped.get('STABLE_BUILD_TAILNET_PROBE_URL')).toBe(GOOD);
	});

	it.each([
		'http://gftb-probe.example.ts.net/probe.svg',
		'https://gftb-probe.example.ts.net:443/probe.svg',
		'https://gftb-probe.example.ts.net/probe.svg?x=1',
		'https://user:hunter2-not-a-secret@gftb-probe.example.ts.net/probe.svg',
		'https://GFTB-PROBE.example.ts.net/probe.svg',
		'https://a.b.example.ts.net/probe.svg',
		'https://gftb-probe.example.com/probe.svg',
		'https://gftb-probe.example.ts.net/probe.svg\nSTABLE_BUILD_COMMIT_SHA evil',
	])('rejects %j without echoing it and without failing unrelated targets', (bad) => {
		const done = runStatus({ PUBLIC_TAILNET_PROBE_URL: bad, BUILD_COMMIT_SHA: 'deadbeefcafe' });
		// The status command runs for every Bazel command: it must still succeed.
		expect(done.status).toBe(0);
		expect(done.stamped.get('STABLE_BUILD_TAILNET_PROBE_URL')).toBe(INVALID_MARKER);
		expect(done.stamped.get('STABLE_BUILD_COMMIT_SHA')).toBe('deadbee');
		expect(done.stamped.get('STABLE_BUILD_BASE_PATH')).toBe('__EMPTY__');
		expect(done.stderr).toContain('value not shown');
		for (const part of [bad, 'hunter2', 'GFTB-PROBE', 'example.com', ':443', 'evil']) {
			if (bad.includes(part)) {
				expect(done.stderr).not.toContain(part);
				expect(done.stdout).not.toContain(part);
			}
		}
	});

	it('uses byte-wise ranges whatever the caller locale', () => {
		const done = runStatus({
			PUBLIC_TAILNET_PROBE_URL: 'https://gftb-Probe.example.ts.net/probe.svg',
			LC_ALL: 'en_US.UTF-8',
			LANG: 'en_US.UTF-8',
		});
		expect(done.stamped.get('STABLE_BUILD_TAILNET_PROBE_URL')).toBe(INVALID_MARKER);
	});
});

describe('readBuildMetadata (//:build)', () => {
	const base = ['STABLE_BUILD_BASE_PATH __EMPTY__', 'STABLE_BUILD_COMMIT_SHA deadbee'];

	it('requires the stable status file', () => {
		expect(() => readBuildMetadata({}, '/')).toThrow(/BAZEL_STABLE_STATUS_FILE is required/u);
	});

	it('fails when the probe key is missing', () => {
		expect(() => readBuildMetadata(statusFile(base), '/')).toThrow(/build metadata keys are missing/u);
	});

	it('decodes the empty marker and a stamped URL', () => {
		const empty = statusFile([...base, 'STABLE_BUILD_TAILNET_PROBE_URL __EMPTY__']);
		expect(readBuildMetadata(empty, '/')).toEqual({ basePath: '', commitSha: 'deadbee', tailnetProbeUrl: '' });
		const set = statusFile([...base, `STABLE_BUILD_TAILNET_PROBE_URL ${GOOD}`]);
		expect(readBuildMetadata(set, '/').tailnetProbeUrl).toBe(GOOD);
	});

	it('fails on the invalid marker with fixed text', () => {
		const invalid = statusFile([...base, `STABLE_BUILD_TAILNET_PROBE_URL ${INVALID_MARKER}`]);
		expect(() => readBuildMetadata(invalid, '/')).toThrow(MALFORMED_PROBE_URL_MESSAGE);
	});

	it('ignores an ambient PUBLIC_TAILNET_PROBE_URL', () => {
		const empty = statusFile([...base, 'STABLE_BUILD_TAILNET_PROBE_URL __EMPTY__']);
		expect(readBuildMetadata({ ...empty, PUBLIC_TAILNET_PROBE_URL: GOOD }, '/').tailnetProbeUrl).toBe('');
	});
});

describe('readTailnetProbeUrl (//:scanned_build and just leak-scan)', () => {
	const other = 'https://other.example.ts.net/probe.svg';

	it('inside Bazel reads only the stamp, never the environment', () => {
		const env = { ...statusFile([`STABLE_BUILD_TAILNET_PROBE_URL ${GOOD}`]), PUBLIC_TAILNET_PROBE_URL: other };
		expect(readTailnetProbeUrl(env, '/')).toEqual({ url: GOOD, source: 'stamp' });
	});

	it('inside Bazel a missing key means no allowance, even with the variable exported', () => {
		const env = { ...statusFile(['STABLE_BUILD_COMMIT_SHA deadbee']), PUBLIC_TAILNET_PROBE_URL: other };
		expect(readTailnetProbeUrl(env, '/')).toEqual({ url: '', source: 'stamp' });
		expect(tailnetProbeHost(readTailnetProbeUrl(env, '/').url)).toBe('');
	});

	it('inside Bazel the invalid marker fails the scan instead of widening it', () => {
		const env = statusFile([`STABLE_BUILD_TAILNET_PROBE_URL ${INVALID_MARKER}`]);
		expect(() => tailnetProbeHost(readTailnetProbeUrl(env, '/').url)).toThrow(/value not shown/u);
	});

	it('outside Bazel falls back to the caller environment', () => {
		expect(readTailnetProbeUrl({ PUBLIC_TAILNET_PROBE_URL: other }, '/')).toEqual({
			url: other,
			source: 'environment',
		});
		expect(readTailnetProbeUrl({}, '/')).toEqual({ url: '', source: 'environment' });
	});
});
