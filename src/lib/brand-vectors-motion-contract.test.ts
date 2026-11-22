import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The members site pins idle drift in src/lib/brand-vectors-motion-contract.test.ts.
// Through v0.3.6 damping erased idle jitter in ~1.4s. v0.3.7 reads driftAngle/driftSpeed
// even without pointer or sensor input. prefers-reduced-motion still freezes the frame. The
// members site records its package.json archive in PINNED_INTEGRITY. TIN-2838 requires this
// site to pin the same supply chain through Bazel. scripts/check-inhouse-package-parity.py
// excludes an npm specifier. MODULE.bazel selects 0.3.7 or later and binds
// single_version_override to an immutable bazel-registry commit. R574 requires resolution
// under --ignore_all_rc_files without a registry in .bazelrc. MODULE.bazel.lock records
// that commit’s source.json with the archive’s sha256 integrity.

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
		const moduleBazel = readFileSync(path.join(repoRoot, 'MODULE.bazel'), 'utf8');
		const registry = moduleBazel.match(
			/single_version_override\(\s*module_name = "tummycrypt_tinyvectors",\s*registry = "(https:\/\/raw\.githubusercontent\.com\/xoxd-ai\/bazel-registry\/[0-9a-f]{40})",\s*\)/,
		)?.[1];
		expect(registry, 'an immutable-SHA xoxd-ai bazel-registry binding in MODULE.bazel').toBeTruthy();
		// R574: no rc file names a registry, so the fabric's
		// --ignore_all_rc_files invocation resolves the same graph.
		const bazelrc = readFileSync(path.join(repoRoot, '.bazelrc'), 'utf8');
		expect(bazelrc).not.toMatch(/--registry/);
		const lock = readFileSync(path.join(repoRoot, 'MODULE.bazel.lock'), 'utf8');
		// The lock must hash the pinned version's source.json (the registry
		// file that carries the source archive's sha256 integrity) under the
		// exact registry commit MODULE.bazel binds. A version bump,
		// registry-pin bump, or stale lock breaks this seam before any build
		// does.
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
		// CSS Backgrounds 3 §2.11.2 lets body propagate its background to a transparent root
		// canvas. Skeleton sets an html background. Leaving it opaque puts the body background
		// above the negative-z layer and hides the blobs. PR #62 exposed this failure. The `html,
		// body` print reset hides the layer on paper.
		for (const match of appCss.matchAll(/^:root\s*\{([\s\S]*?)\n\}/gmu)) {
			expect(match[1], `root-level rule must not declare a background (canvas propagation):\n${match[0]}`).not.toMatch(
				/^\s*background(?:-color|-image)?\s*:/mu,
			);
		}
		const htmlBlock = /^html\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1] ?? '';
		expect(htmlBlock, 'clear the imported root fill and image').toMatch(/^\s*background:\s*transparent;/mu);
		// The registered browser spec checks the compiled cascade and paint,
		// including imported CSS that this source-level seam cannot inspect.
		const bodyBlock = /^body\s*\{([\s\S]*?)\n\}/mu.exec(appCss)?.[1] ?? '';
		expect(bodyBlock, 'body owns the propagated canvas background').toMatch(/^\s*background:/mu);
	});

	it('layout call site keeps the animated + reduced-motion defaults and the devicemotion enhancement', () => {
		const layout = readFileSync(path.join(repoRoot, 'src', 'routes', '+layout.svelte'), 'utf8');
		const block = layout.match(/<TinyVectors[\s\S]*?\/>/);
		expect(block, 'a <TinyVectors ... /> block in +layout.svelte').not.toBeNull();
		// Keep animated and respectReducedMotion at their true defaults for idle drift and a
		// frozen frame under prefers-reduced-motion.
		expect(block![0]).not.toMatch(/animated=\{false\}/);
		expect(block![0]).not.toMatch(/respectReducedMotion=\{false\}/);
		// Devicemotion stays the enhancement layer. The bound instance's
		// existing permission API feeds the silent first-gesture handshake
		// (operator ruling 2026-09-09); no permission control is rendered anywhere.
		expect(block![0]).toMatch(/enableDeviceMotion=\{true\}/);
		expect(block![0]).toMatch(/bind:this=\{tinyVectorsRef\}/);
		expect(layout).not.toMatch(/class="[^"]*motion-permission/u);
		expect(layout).not.toContain('MotionPermissionState');
		expect(layout).not.toContain('Let the blobs feel');
		expect(layout).toContain('createDeviceMotionHandshake(');
		// The 2026-09-09 ruling disables pointer physics so scroll pulls blobs toward the centre.
		// The 0.3.7 idle cruise needs neither a sensor nor a gesture.
		expect(block![0]).toMatch(/enablePointerPhysics=\{false\}/);
		const appCss = readFileSync(path.join(repoRoot, 'src', 'app.css'), 'utf8');
		expect(appCss).not.toContain('.motion-permission');
	});
});
