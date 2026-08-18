// Prerendered sitemap for the one-page public microsite.
import type { RequestHandler } from './$types';

const SITE = 'https://greatfallstoolbus.org';
const PAGES: string[] = ['/'];

export const prerender = true;

export const GET: RequestHandler = () => {
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`;
	return new Response(xml, {
		headers: {
			'content-type': 'application/xml; charset=utf-8',
		},
	});
};
