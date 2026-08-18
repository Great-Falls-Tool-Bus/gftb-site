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
		adapter: adapter({
			pages: process.env.BUILD_OUTPUT_DIR ?? 'build',
			assets: process.env.BUILD_OUTPUT_DIR ?? 'build',
			fallback: '404.html',
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
