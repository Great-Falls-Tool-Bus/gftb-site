import { publicLogs } from './public-logs';

// Each public page's own document title, "Page name | Great Falls Tool Bus"
// (operator approval 2026-11-14). Tabs, history and screen readers then tell
// pages apart. The home page keeps the bare site name. The error surfaces
// keep their own title in the layout.

export const SITE_NAME = 'Great Falls Tool Bus';

/** Page names by path, without the trailing slash the static output adds. */
const PAGE_NAMES: Readonly<Record<string, string>> = {
	'/log': 'Public log',
	'/contact': 'Contact',
	'/join': 'Join',
	'/legal': 'Legal',
	'/privacy': 'Privacy',
	'/refund-policy': 'Contribution refunds',
};

function pageName(path: string): string | null {
	const named = PAGE_NAMES[path];
	if (named) return named;
	const archive = /^\/log\/page\/(\d+)$/u.exec(path);
	if (archive) return `Public log, page ${archive[1]}`;
	const entry = /^\/log\/([^/]+)$/u.exec(path);
	if (entry) return publicLogs.find((log) => log.slug === entry[1])?.metadata.title ?? null;
	return null;
}

/** The document title for a path. Unknown paths get the bare site name. */
export function pageTitle(pathname: string): string {
	const path = pathname.replace(/\/+$/u, '') || '/';
	if (path === '/') return SITE_NAME;
	const name = pageName(path);
	return name ? `${name} | ${SITE_NAME}` : SITE_NAME;
}
