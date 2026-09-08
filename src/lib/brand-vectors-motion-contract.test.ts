import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Brand-vectors default-motion contract (TinyVectors idle drift) — apex port
// of the members site's src/lib/brand-vectors-motion-contract.test.ts.
//
// Through v0.3.6 the tinyvectors physics loop never read each blob's
// driftAngle/driftSpeed cruise field: with no pointer, scroll, or
// devicemotion input (i.e. every idle desktop), the only motion was a
// zero-mean jitter random walk the engine's damping erased in ~1.4s, so the
// background read as frozen-with-a-shiver. v0.3.7 wires that cruise in —
// idle drift/bounce is the package default on ALL environments, with no
// permission grant or sensor required, while devicemotion still only
// ENHANCES motion and prefers-reduced-motion still freezes the frame
// entirely.
//
// The members site delivers the pin through a package.json URL-tarball spec
// plus a prepare-hook PINNED_INTEGRITY table. This carrier is Bazel-only
// (TIN-2838; scripts/check-inhouse-package-parity.py forbids the npm
// specifier), so the same seams live in the Bazel supply chain instead:
// - the MODULE.bazel bazel_dep pin must stay at or above 0.3.7 (the first
//   release with the idle drift cruise);
// - MODULE.bazel.lock must record the pinned version's source.json under the
//   exact immutable bazel-registry commit .bazelrc names (the registry file
//   that carries the archive's sha256 integrity — the lock hashing that file
//   is the frozen-lockfile analog of the members' PINNED_INTEGRITY entry);
// - the layout call site must not opt out of the animated default or the
//   reduced-motion default.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const IDLE_DRIFT_FLOOR = [0, 3, 7] as const;

function parsePinnedTinyvectorsVersion(): { raw: string; version: number[] } {
	const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
	const match = moduleBazel.match(/bazel_dep\(name = "tummycrypt_tinyvectors", version = "(\d+)\.(\d+)\.(\d+)"\)/);
	expect(match, 'a tummycrypt_tinyvectors bazel_dep pin in MODULE.bazel').not.toBeNull();
	return { raw: match!.slice(1, 4).join('.'), version: match!.slice(1, 4).map(Number) };
}

describe('tinyvectors default-motion contract', () => {
	it('pins tummycrypt_tinyvectors at or above 0.3.7 (idle drift cruise is the default)', () => {
		const { version } = parsePinnedTinyvectorsVersion();
		const floor = IDLE_DRIFT_FLOOR.reduce<number>((s, n) => s * 1000 + n, 0);
		const pinned = version.reduce((s, n) => s * 1000 + n, 0);
		expect(pinned).toBeGreaterThanOrEqual(floor);
	});

	it('keeps the pinned version resolvable ONLY through the immutable registry commit', () => {
		const { raw } = parsePinnedTinyvectorsVersion();
		const bazelrc = readFileSync(path.join(repoRoot, '.bazelrc'), 'utf8');
		const registry = bazelrc.match(
			/--registry=(https:\/\/raw\.githubusercontent\.com\/tinyland-inc\/bazel-registry\/[0-9a-f]{40})/,
		)?.[1];
		expect(registry, 'an immutable-SHA tinyland bazel-registry pin in .bazelrc').toBeTruthy();
		const lock = readFileSync(path.join(repoRoot, 'MODULE.bazel.lock'), 'utf8');
		// The lock must hash the pinned version's source.json — the registry
		// file that carries the source archive's sha256 integrity — under the
		// exact registry commit .bazelrc names. A version bump, registry-pin
		// bump, or stale lock breaks this seam before any build does.
		expect(lock).toContain(`${registry}/modules/tummycrypt_tinyvectors/${raw}/source.json`);
	});

	it('keeps the canvas layering that makes the below-content layer paint at all', () => {
		const appCss = readFileSync(path.join(repoRoot, 'src', 'app.css'), 'utf8');
		// The blob host is a fixed, negative-z layer in the root stacking
		// context.
		const layer = /^\.brand-vectors-bg\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1] ?? '';
		expect(layer, 'a .brand-vectors-bg rule in app.css').not.toBe('');
		expect(layer).toMatch(/position: fixed;/u);
		expect(layer).toMatch(/z-index: -1;/u);
		// Canvas propagation contract (CSS Backgrounds 3 §2.11.2): a
		// negative-z layer paints above the canvas background but below every
		// in-flow background, so the page ground must live on the CANVAS —
		// body propagates it there — and no root-level rule may declare a
		// background of its own. A background on :root (or html) stops the
		// propagation: body's opaque ground then paints on body's own box,
		// which stacks OVER all negative-z layers, and the blobs render fully
		// occluded while their physics loop keeps burning frames (the PR #62
		// round-3 regression). The print block's `html, body` reset is a
		// different selector shape and stays exempt: paper hides the layer
		// outright.
		for (const match of appCss.matchAll(/^(?::root|html)\s*\{([\s\S]*?)\n\}/gmu)) {
			expect(match[1], `root-level rule must not declare a background (canvas propagation):\n${match[0]}`).not.toMatch(
				/^\s*background\s*:/mu,
			);
		}
		const bodyBlock = /^body\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1] ?? '';
		expect(bodyBlock, 'body owns the propagated canvas background').toMatch(/^\s*background:/mu);
	});

	it('layout call site keeps the animated + reduced-motion defaults and the devicemotion enhancement', () => {
		const layout = readFileSync(path.join(repoRoot, 'src', 'routes', '+layout.svelte'), 'utf8');
		const block = layout.match(/<TinyVectors[\s\S]*?\/>/);
		expect(block, 'a <TinyVectors ... /> block in +layout.svelte').not.toBeNull();
		// animated defaults to true and respectReducedMotion defaults to true:
		// the call site must not override either (idle drift on desktop,
		// full freeze under prefers-reduced-motion).
		expect(block![0]).not.toMatch(/animated=\{false\}/);
		expect(block![0]).not.toMatch(/respectReducedMotion=\{false\}/);
		// Devicemotion stays the enhancement layer. The bound instance's
		// existing permission API supplies the separate user-gesture control.
		expect(block![0]).toMatch(/enableDeviceMotion=\{true\}/);
		expect(block![0]).toMatch(/bind:this=\{tinyVectorsRef\}/);
	});
});
