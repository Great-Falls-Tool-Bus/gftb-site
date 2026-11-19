// vite.config.ts passes these options to the SvelteKit 3 plugin.
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { escapeSvelte, mdsvex } from 'mdsvex';
import { codeToHtml } from 'shiki';

// Shiki highlights code during prerender. src/app.css selects each token color
// from --shiki-light or --shiki-dark using the page's data-mode.
const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' };

/**
 * @param {string} code
 * @param {string | null | undefined} lang
 */
async function highlighter(code, lang) {
	const html = await codeToHtml(code, {
		lang: lang || 'text',
		themes: SHIKI_THEMES,
		defaultColor: false,
	});
	return `{@html \`${escapeSvelte(html)}\`}`;
}

const mdsvexPreprocessor = /** @type {import('svelte/compiler').PreprocessorGroup} */ (
	mdsvex({ extensions: ['.svx'], highlight: { highlighter } })
);
// mdsvex 0.12.7 still emits the legacy Svelte module-script spelling for
// frontmatter. Skeleton 5's proven Svelte 5 carrier rewrites it at preprocess
// time so the public log remains build-time content, not a runtime CMS.
/** @type {import('svelte/compiler').PreprocessorGroup} */
const mdsvexSvelte5Preprocessor = {
	...mdsvexPreprocessor,
	async markup(options) {
		const result = await mdsvexPreprocessor.markup?.(options);
		if (!result?.code) return result;
		return {
			...result,
			code: result.code.replaceAll('<script context="module">', '<script module>'),
		};
	},
};

/** @type {NonNullable<Parameters<typeof import('@sveltejs/kit/vite').sveltekit>[0]>} */
const config = {
	extensions: ['.svelte', '.svx'],
	preprocess: [vitePreprocess(), mdsvexSvelte5Preprocessor],
	compilerOptions: {
		runes: true,
	},
	// Caddy serves the prerendered build/404.html at missing paths.
	// An adapter fallback would overwrite it with an empty client shell.
	adapter: adapter({
		pages: process.env.BUILD_OUTPUT_DIR ?? 'build',
		assets: process.env.BUILD_OUTPUT_DIR ?? 'build',
		precompress: true,
		strict: false,
	}),
	paths: {
		// The static artifact is mounted at the apex by the external apply plane.
		base: /** @type {'' | `/${string}`} */ (process.env.BASE_PATH ?? ''),
	},
	prerender: {
		handleHttpError: 'warn',
		handleMissingId: 'warn',
		// /log/[slug] and /log/page/[n] can have no entries when the archive is empty.
		handleUnseenRoutes: 'warn',
	},
};

export default config;
