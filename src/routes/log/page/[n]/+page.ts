import { error } from '@sveltejs/kit';
import { logPage, logPageCount } from '#lib/public-logs.js';
import type { EntryGenerator, PageLoad } from './$types';

// /log serves page 1. Prerender later pages only when they contain entries.
export const prerender = true;

// The static server serves directory URLs without extension rewriting.
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
