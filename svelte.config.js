import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { escapeSvelte, mdsvex } from 'mdsvex';
import { codeToHtml } from 'shiki';

// Code-surface contract (D07): svx code fences are highlighted AT BUILD TIME
// by shiki with a light+dark theme pair and `defaultColor: false`, so the
// emitted `pre.shiki` markup carries only `--shiki-light`/`--shiki-dark`
// custom properties per token — src/app.css walks those variables into
// painted colour, keyed on the same data-mode attribute as the role layer.
// No shiki byte ever reaches the client bundle: this runs inside the mdsvex
// preprocessor, and the output is static HTML.
const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' };

async function highlighter(code, lang) {
	const html = await codeToHtml(code, {
		lang: lang || 'text',
		themes: SHIKI_THEMES,
		defaultColor: false,
	});
	return `{@html \`${escapeSvelte(html)}\`}`;
}

const mdsvexPreprocessor = mdsvex({ extensions: ['.svx'], highlight: { highlighter } });
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
			// /log/[slug] and /log/page/[n] generate their entries from the
			// PUBLISHED log set (B1.2). While every checked-in post is still a
			// published:false TODO(jess) draft the set is empty, which is a
			// legitimate state, not a crawl failure — warn, never fail.
			handleUnseenRoutes: 'warn',
		},
	},
};

export default config;
