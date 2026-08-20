// Prerendered sitemap. Static pages plus the published log permalinks and
// archive pages — all derived from the same loader every rendered surface
// uses, so drafts (published: false) can never appear here (spec §3).
import { logPageCount, publicLogs } from '$lib/public-logs';
import type { RequestHandler } from './$types';

const SITE = 'https://greatfallstoolbus.org';

export const prerender = true;

export const GET: RequestHandler = () => {
	// Nested pages are directory-shaped (trailingSlash 'always'), so their
	// canonical URLs carry the trailing slash the server redirects to.
	const pages: string[] = ['/', '/log/', '/contact/'];
	for (let n = 2; n <= logPageCount(); n += 1) pages.push(`/log/page/${n}/`);
	for (const entry of publicLogs) pages.push(`/log/${entry.slug}/`);

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`;
	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
		},
	});
};
