import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TINYVECTORS_TELLS, checkServedTinyvectors, pinnedVersion } from './check-served-tinyvectors.mjs';

const MODULE = 'bazel_dep(name = "tummycrypt_tinyvectors", version = "0.3.7")\n';
const dirs: string[] = [];

function build(chunk: string) {
	const dir = mkdtempSync(join(tmpdir(), 'served-tv-'));
	dirs.push(dir);
	mkdirSync(join(dir, '_app', 'immutable', 'nodes'), { recursive: true });
	writeFileSync(join(dir, '_app', 'immutable', 'nodes', '0.abc123.js'), chunk);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('served-artifact proof for the tinyvectors pin', () => {
	it('reads the pin from MODULE.bazel and has a tell for it', () => {
		expect(pinnedVersion(MODULE)).toBe('0.3.7');
		expect(TINYVECTORS_TELLS['0.3.7']).toBeDefined();
		expect(() => pinnedVersion('module(name = "x")')).toThrow();
	});

	it('passes a build that carries the pinned release', () => {
		const dir = build('const a={driftSpeed:.05+Math.random()*.05};');
		expect(checkServedTinyvectors(dir, MODULE)).toEqual([]);
	});

	it('fails a build that bundled the pre-cruise release', () => {
		const dir = build('const a={driftSpeed:.01+Math.random()*.015};');
		const problems = checkServedTinyvectors(dir, MODULE);
		expect(problems).toHaveLength(2);
		expect(problems[0]).toMatch(/never carries the 0\.3\.7 tell/u);
		expect(problems[1]).toMatch(/pre-0\.3\.7 tinyvectors tell/u);
	});

	it('fails closed on a pin bump without a registered tell', () => {
		const dir = build('const a={driftSpeed:.05+Math.random()*.05};');
		const problems = checkServedTinyvectors(dir, MODULE.replace('0.3.7', '0.3.8'));
		expect(problems).toHaveLength(1);
		expect(problems[0]).toMatch(/no served-artifact tell is registered for tummycrypt_tinyvectors 0\.3\.8/u);
	});

	it('fails on a build with no client chunks', () => {
		const dir = mkdtempSync(join(tmpdir(), 'served-tv-'));
		dirs.push(dir);
		mkdirSync(join(dir, '_app', 'immutable'), { recursive: true });
		expect(checkServedTinyvectors(dir, MODULE)[0]).toMatch(/no client chunks/u);
	});
});
