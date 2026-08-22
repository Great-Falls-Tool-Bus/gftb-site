import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { accessibilityPlugin } from '@tummycrypt/vite-plugin-a11y';
import { defineConfig, type PluginOption } from 'vite';
import pkg from './package.json';

// Stamped Bazel build actions set BUILD_COMMIT_SHA from their stable-status
// input. Dev runs may supply it explicitly; otherwise they report unknown.
// The stamp (scripts/bazel/workspace-status.sh) carries an EXPLICITLY
// supplied identity only and is already truncated to 7 chars at that source,
// so no 40-hex value can ever be inlined below. The footer provenance line
// (src/lib/build-info.ts) consumes __COMMIT_SHORT__ and renders nothing for
// 'unknown', which keeps local builds provenance-free.
const commitHash = process.env.BUILD_COMMIT_SHA || 'unknown';
const buildInfo = {
	version: pkg.version,
	commitHash,
	commitShort: commitHash === 'unknown' ? 'unknown' : commitHash.slice(0, 7),
};

// Bundle profiling: `ANALYZE=1 just build` (or `just analyze`) emits an
// interactive treemap at .bundle-stats/stats.html. Loaded lazily at module
// scope so ordinary builds never touch the plugin (it is a devDependency
// only). BUILD_ANALYZE is honored for backwards compatibility with the old
// Justfile recipe. Mirrors MassageIthaca/vite.config.ts.
const analyzePlugins: PluginOption[] = [];
const analyzeRequested =
	process.env.ANALYZE === '1' ||
	process.env.ANALYZE === 'true' ||
	process.env.BUILD_ANALYZE === '1' ||
	process.env.BUILD_ANALYZE === 'true';
if (analyzeRequested) {
	const { visualizer } = await import('rollup-plugin-visualizer');
	analyzePlugins.push(
		visualizer({
			filename: process.env.ANALYZE_OUTPUT_PATH ?? '.bundle-stats/stats.html',
			template: 'treemap',
			gzipSize: true,
			brotliSize: true,
		}) as unknown as Plugin,
	);
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		accessibilityPlugin({
			wcagLevel: 'AA',
			failOnError: false,
		}),
		sveltekit(),
		...analyzePlugins,
	],

	// Build-time constants. Source that reads __VERSION__ / __COMMIT_HASH__
	// should declare them as ambient globals (see src/app.d.ts when needed).
	define: {
		__VERSION__: JSON.stringify(buildInfo.version),
		__COMMIT_HASH__: JSON.stringify(buildInfo.commitHash),
		__COMMIT_SHORT__: JSON.stringify(buildInfo.commitShort),
	},

	build: {
		reportCompressedSize: true,
		chunkSizeWarningLimit: 250,

		// CSS code splitting + Lightning CSS minification (mirrors MI).
		cssCodeSplit: true,
		cssMinify: 'lightningcss',
	},
});
