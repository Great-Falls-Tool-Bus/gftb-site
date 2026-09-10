import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { accessibilityPlugin } from '@tummycrypt/vite-plugin-a11y';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import pkg from './package.json';

// The source-marker action projects native BUILD_EMBED_LABEL into health.sha.
// The build adapter reads that exact file, not Bazel's whole status files, and
// sets BUILD_COMMIT_SHA to its seven-character prefix. Missing or malformed
// identity fails before Vite runs. Caddy serves the full SHA at /health.sha;
// it is excluded from page bundles, not private. Dev/test rendering without
// that adapter has no provenance and the footer renders no line for 'unknown'.
const commitHash = process.env.BUILD_COMMIT_SHA || 'unknown';
const buildInfo = {
	version: pkg.version,
	commitHash,
	commitShort: commitHash === 'unknown' ? 'unknown' : commitHash.slice(0, 7),
};

// The parked //:analyze graph target emits an interactive bundle treemap.
// It is not a declared ActionPlan action or a local execution entrypoint.
// Loaded lazily at module
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
		}) as Plugin,
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
