import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Exact frontend pins for this intentionally small Svelte 5 carrier.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
	packageManager?: string;
	engines?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const allDeclaredDeps: Record<string, string> = {
	...(packageJson.dependencies ?? {}),
	...(packageJson.devDependencies ?? {}),
	...(packageJson.optionalDependencies ?? {}),
	...(packageJson.peerDependencies ?? {}),
};

describe('house frontend-stack exact-pin contract', () => {
	it('keeps the approved Skeleton 5 pair EXACT at 5.0.1', () => {
		expect(packageJson.devDependencies?.['@skeletonlabs/skeleton']).toBe('5.0.1');
		expect(packageJson.devDependencies?.['@skeletonlabs/skeleton-svelte']).toBe('5.0.1');
	});

	it('keeps typescript EXACT-pinned on the 6.0.x line (no caret/tilde float)', () => {
		expect(packageJson.devDependencies?.typescript).toMatch(/^6\.0\.\d+$/);
	});

	it('keeps pnpm 10.13.1 EXACT via packageManager (never pnpm 9)', () => {
		expect(packageJson.packageManager).toBe('pnpm@10.13.1');
	});

	it('does not carry an icon package for a text-first one-page site', () => {
		expect(packageJson.dependencies?.['@lucide/svelte']).toBeUndefined();
		expect(allDeclaredDeps['lucide-svelte']).toBeUndefined();
	});

	it('never declares @zag-js as a direct dependency (transitive through Skeleton only)', () => {
		const directZag = Object.keys(allDeclaredDeps).filter((name) => name === '@zag-js' || name.startsWith('@zag-js/'));
		expect(directZag).toEqual([]);
	});

	it('keeps the Node engine range inside ESLint 10 support', () => {
		expect(packageJson.engines?.node).toBe('^22.13.0 || >=24 <25');
	});

	it('keeps MODULE.bazel ts_version identical to the package.json typescript pin', () => {
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const tsVersion = moduleBazel.match(/ts_version\s*=\s*"([^"]+)"/)?.[1];
		expect(tsVersion).toBe(packageJson.devDependencies?.typescript);
	});

	it('keeps @tummycrypt/tinyvectors Bazel-only at EXACT 0.3.7 (bazel_dep pin, no npm specifier)', () => {
		// Bazel-only ingestion (TIN-2838): the version pin lives in
		// MODULE.bazel and the package is graph-linked via npm_link_package;
		// scripts/check-inhouse-package-parity.py forbids the npm-shadow
		// specifier this row also guards against. The 0.3.7 FLOOR (idle drift
		// default) is pinned separately by brand-vectors-motion-contract.
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const pin = moduleBazel.match(/bazel_dep\(name = "tummycrypt_tinyvectors", version = "([^"]+)"\)/)?.[1];
		expect(pin).toBe('0.3.7');
		expect(allDeclaredDeps['@tummycrypt/tinyvectors']).toBeUndefined();
	});
});
