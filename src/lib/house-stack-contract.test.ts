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

	it('keeps typescript EXACT at 7.0.2, the native compiler (RU1, RU13)', () => {
		expect(packageJson.devDependencies?.typescript).toBe('7.0.2');
		// RU13: no @typescript/native alias and no second TypeScript under an alias.
		expect(allDeclaredDeps['@typescript/native']).toBeUndefined();
		for (const specifier of Object.values(allDeclaredDeps)) {
			expect(specifier).not.toMatch(/^npm:typescript@/u);
		}
	});

	it('keeps the RU1 frontend stack EXACT (RU5: no caret or tilde float)', () => {
		const exact: Record<string, string> = {
			'@playwright/test': '1.64.0',
			'@sveltejs/adapter-static': '4.0.0',
			'@sveltejs/kit': '3.0.1',
			'@sveltejs/vite-plugin-svelte': '7.3.1',
			'@vitest/coverage-v8': '5.0.3',
			svelte: '5.57.2',
			'svelte-check': '4.7.6',
			vite: '8.3.3',
			vitest: '5.0.3',
		};
		for (const [name, version] of Object.entries(exact)) {
			expect(allDeclaredDeps[name], name).toBe(version);
		}
	});

	it('loads TypeScript 6 only as the RU13b in-process parser companion', () => {
		// RU13b: @typescript/typescript6 is the parser library for Kit sync,
		// svelte2tsx and typescript-eslint until TypeScript 7 ships a JS API.
		// It is never `typescript` itself and never a `tsc` on the path.
		expect(packageJson.devDependencies?.['@typescript/typescript6']).toBe('6.0.2');
		const pnpmfile = readFileSync(path.join(repoRoot, '.pnpmfile.cjs'), 'utf8');
		expect(pnpmfile).toContain("const COMPANION = 'npm:@typescript/typescript6@6.0.2';");
		const workspace = readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
		for (const patch of [
			"'@sveltejs/kit@3.0.1': patches/@sveltejs__kit@3.0.1.patch",
			'svelte-check@4.7.6: patches/svelte-check@4.7.6.patch',
		]) {
			expect(workspace).toContain(patch);
		}
		const lock = readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
		// The only TypeScript 6 in the graph is the companion's own @typescript/old.
		// pnpm lists each version under both `packages:` and `snapshots:`, so
		// count distinct versions, not key lines.
		const ts6Versions = new Set(lock.match(/^ {2}typescript@6\.[^:(]*/gmu) ?? []);
		expect(ts6Versions.size).toBeLessThanOrEqual(1);
		expect(lock).toMatch(/^ {2}typescript@7\.0\.2:/mu);
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
		// SvelteKit 3 requires Node >= 22.17.
		expect(packageJson.engines?.node).toBe('^22.17.0 || >=24 <25');
	});

	it('keeps the MODULE.bazel rules_ts TypeScript identical to the package.json typescript pin', () => {
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const tsVersion = moduleBazel.match(/typescript\.deps\(\s*version\s*=\s*"([^"]+)"/)?.[1];
		expect(tsVersion).toBe(packageJson.devDependencies?.typescript);
	});

	it('keeps @tummycrypt/tinyvectors Bazel-only at EXACT 1.0.0 (bazel_dep pin, no npm specifier)', () => {
		// Bazel-only ingestion (TIN-2838): the version pin lives in
		// MODULE.bazel and the package is graph-linked via npm_link_package;
		// scripts/check-inhouse-package-parity.py forbids the npm-shadow
		// specifier this row also guards against. The 0.3.7 FLOOR (idle drift
		// default) is pinned separately by brand-vectors-motion-contract.
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const pin = moduleBazel.match(/bazel_dep\(name = "tummycrypt_tinyvectors", version = "([^"]+)"\)/)?.[1];
		expect(pin).toBe('1.0.0');
		expect(allDeclaredDeps['@tummycrypt/tinyvectors']).toBeUndefined();
	});
});
