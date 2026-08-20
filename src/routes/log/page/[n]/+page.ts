import { error } from '@sveltejs/kit';
import { logPage, logPageCount } from '$lib/public-logs';
import type { EntryGenerator, PageLoad } from './$types';

// Prerendered archive pages 2..N (spec :90-91): the no-JavaScript pagination
// path is plain anchors between fully prerendered pages. Page 1 is /log; the
// generator only emits deeper pages when they exist, so the route disappears
// from the build until the archive outgrows one page.
export const prerender = true;

// Directory-shaped output — see contact/+page.ts.
export const trailingSlash = 'always';

export const entries: EntryGenerator = () => {
	const pages = [];
	for (let n = 2; n <= logPageCount(); n += 1) pages.push({ n: String(n) });
	return pages;
};

export const load: PageLoad = ({ params }) => {
	const n = Number(params.n);
	if (!Number.isInteger(n) || n < 2 || n > logPageCount()) error(404, 'no such log page');
	return {
		page: n,
		pageCount: logPageCount(),
		slugs: logPage(n).map((entry) => entry.slug),
	};
};
