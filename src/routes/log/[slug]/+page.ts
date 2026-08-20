import { error } from '@sveltejs/kit';
import { publicLogs } from '$lib/public-logs';
import type { EntryGenerator, PageLoad } from './$types';

// Permalink pages for published entries only (spec §3 log schema; B1.2).
// Drafts (published: false) are excluded at the loader, so they have no
// permalink and never prerender.
export const prerender = true;

// Directory-shaped output — see contact/+page.ts.
export const trailingSlash = 'always';

export const entries: EntryGenerator = () => publicLogs.map((entry) => ({ slug: entry.slug }));

export const load: PageLoad = ({ params }) => {
	const index = publicLogs.findIndex((entry) => entry.slug === params.slug);
	if (index === -1) error(404, 'no such log entry');
	return { slug: params.slug };
};
