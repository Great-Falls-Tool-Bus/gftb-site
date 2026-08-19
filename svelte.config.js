import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';

const mdsvexPreprocessor = mdsvex({ extensions: ['.svx'] });
// mdsvex 0.12.7 still emits the legacy Svelte module-script spelling for
// frontmatter. Skeleton 5's proven Svelte 5 carrier rewrites it at preprocess
// time so the public log remains build-time content, not a runtime CMS.
const mdsvexSvelte5Preprocessor = {
	...mdsvexPreprocessor,
	async markup(options) {
		const result = await mdsvexPreprocessor.markup(options);
		if (!result?.code) return result;
		return {
			...result,
			code: result.code.replaceAll('<script context="module">', '<script module>'),
		};
	},
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: ['.svelte', '.svx'],
	preprocess: [vitePreprocess(), mdsvexSvelte5Preprocessor],
	compilerOptions: {
		runes: true,
	},
	kit: {
		// No `fallback`. `src/routes/404` is a prerendered route, so adapter-static
		// writes the real, server-rendered error body to `build/404.html` — which
		// is the file the Caddyfile's `handle_errors` block serves. A fallback
		// would target the same filename and win, because adapter-static writes it
		// after the prerendered pages, and a fallback is rendered with `ssr: false`
		// and an empty branch: no title, no heading, no link home. That is what a
		// scriptless visitor used to get, and it is indistinguishable from the
		// zero-byte body it was supposed to replace.
		adapter: adapter({
			pages: process.env.BUILD_OUTPUT_DIR ?? 'build',
			assets: process.env.BUILD_OUTPUT_DIR ?? 'build',
			precompress: true,
			strict: false,
		}),
		paths: {
			// The static artifact is mounted at the apex by the external apply plane.
			base: process.env.BASE_PATH ?? '',
		},
		prerender: {
			handleHttpError: 'warn',
			handleMissingId: 'warn',
		},
	},
};

export default config;
