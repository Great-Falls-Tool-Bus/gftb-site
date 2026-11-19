import { error } from '@sveltejs/kit';
import { publicLogs } from '#lib/public-logs.js';
import type { EntryGenerator, PageLoad } from './$types';

// The generated manifest excludes drafts, so they have no prerendered permalink.
export const prerender = true;

// The static server serves directory URLs without extension rewriting.
export const trailingSlash = 'always';

export const entries: EntryGenerator = () => publicLogs.map((entry) => ({ slug: entry.slug }));

// Import the body for this published slug during prerender and client navigation.
export const load: PageLoad = async ({ params }) => {
	const entry = publicLogs.find((candidate) => candidate.slug === params.slug);
	if (!entry) error(404, 'no such log entry');
	const module = await entry.loadComponent();
	return { slug: entry.slug, EntryBody: module.default };
};
