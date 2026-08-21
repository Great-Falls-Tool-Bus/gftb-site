import { error } from '@sveltejs/kit';
import { publicLogs } from '$lib/public-logs';
import type { EntryGenerator, PageLoad } from './$types';

// Permalink pages for published entries only (spec §3 log schema; B1.2).
// Drafts (published: false) are excluded at generation time (B1 fix,
// src/lib/generated/log-manifest.ts), so they have no permalink and never
// prerender.
export const prerender = true;

// Directory-shaped output — see contact/+page.ts.
export const trailingSlash = 'always';

export const entries: EntryGenerator = () => publicLogs.map((entry) => ({ slug: entry.slug }));

// Resolves the body component here, in the universal load (re-run on the
// client during hydration/navigation exactly like the server run during
// prerender), rather than reading a pre-resolved `entry.component` — the
// component is only imported per published slug (B1 fix).
export const load: PageLoad = async ({ params }) => {
	const entry = publicLogs.find((candidate) => candidate.slug === params.slug);
	if (!entry) error(404, 'no such log entry');
	const module = await entry.loadComponent();
	return { slug: entry.slug, EntryBody: module.default };
};
