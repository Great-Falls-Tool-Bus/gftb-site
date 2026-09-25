// Single source of truth for navigation, ported from the demo site's
// src/lib/nav-items.ts SSOT pattern (greatfallstoolbus.org@origin/main): the
// header bar and the grouped footer both render from this one array, so the
// two can never drift apart. Icons are deliberately not ported — this
// microsite ships no icon dependency.
//
// Scope note (ADR 0014 §1 / launch-authority-flow): this is the PUBLIC
// microsite. Platform-owned surfaces (/tools, /cells*, /cell-sheets*,
// /keyholders, /discuss) live in gftb-platform and are not navigation here.

interface NavItemBase {
	label: string;
	href: string;
	/** Base-relative path patterns that light this item as the active section. */
	match: string[];
}

/**
 * Rendered in the header bar. Since the operator ruling of 2026-08-31 (GitHub
 * in the header) a primary item may leave the site; the header then renders
 * it through ExternalLink, never a bare `<a>`, so rel/target cannot drift
 * (the PR #35 EDIT-2 concern, now enforced at the render site).
 */
interface HeaderNavItem extends NavItemBase {
	primary: true;
	footerGroup?: never;
	external?: boolean;
}

/** Demoted into a footer group instead of the header bar. */
interface FooterNavItem extends NavItemBase {
	primary?: never;
	/** Which footer group this item is demoted into. */
	footerGroup: 'About' | 'Get involved' | 'Site';
	/**
	 * Destination leaves the site — the footer renders it through
	 * ExternalLink (rel/target + the [↗] mark) instead of a bare anchor.
	 */
	external?: boolean;
}

export type NavItem = HeaderNavItem | FooterNavItem;

export const navItems: NavItem[] = [
	{ label: 'Log', href: '/log', match: ['/log'], primary: true },
	{ label: 'Contact', href: '/contact', match: ['/contact'], primary: true },
	// Operator ruling 2026-09-19: FAQ in the header, linking to the home
	// FAQ section. The footer's own "Questions" row is retired in the same
	// ruling; the fuller footer sitemap (below) carries FAQ instead.
	{ label: 'FAQ', href: '/#faq', match: [], primary: true },
	// Operator ruling 2026-08-31: GitHub in the header. The org page is the
	// public target (gftb-site itself is private; a repo link would 404 for
	// visitors, review E4).
	{ label: 'GitHub', href: 'https://github.com/Great-Falls-Tool-Bus', match: [], primary: true, external: true },
	// Public HyperKitty archive UI for discuss@ — promoted from the footer to
	// the header by operator ruling 2026-09-01 (the discuss board is a
	// top-level nav item; anyone can read, writing requires membership).
	// Header-only, the GitHub precedent — the footer row moved here rather
	// than duplicating. The href stays the deep link to the discuss@ list
	// overview, NOT the /hyperkitty/ root: the deep link is the
	// Anubis-exempted anonymous read path (TIN-2559), while the root's list
	// index invites discovery of the private list's 403 surface. The PRIVATE
	// keyholders@ archive never gets a public link — see
	// scripts/lib/leak-scan-rules.json's private-list-archive rule.
	{
		// LOW-1 (PR #35 review): home and contact both name this destination
		// "public discussion archive"; "Discussion archive" reads unambiguously
		// alongside them and, per the scope note above, keeps clear of
		// gftb-platform's own /discuss surface — "Discuss archive" read like a
		// third name for a fourth thing.
		label: 'Discussion archive',
		href: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/',
		match: [],
		primary: true,
		external: true,
	},
	// Footer navigation: the fuller tinyland.dev-pattern sitemap (operator
	// ruling 2026-09-19). These are separate objects from their header/body
	// counterparts on purpose, since a footer row can carry its own label
	// ("Discussion board" here vs. "Discussion archive" in the header) while
	// still pointing at the same destination; the "Log archive" row below
	// already established the pattern before this ruling.
	{ label: 'Home', href: '/', match: ['/'], footerGroup: 'About' },
	{ label: 'FAQ', href: '/#faq', match: [], footerGroup: 'About' },
	{ label: 'Notes & Goals', href: '/#goals', match: [], footerGroup: 'About' },
	{ label: 'Log archive', href: '/log', match: ['/log'], footerGroup: 'About' },
	{ label: 'Contact a keyholder', href: '/contact', match: ['/contact'], footerGroup: 'Get involved' },
	{
		label: 'Discussion board',
		href: 'https://lists.latoolb.us/hyperkitty/list/discuss@latoolb.us/',
		match: [],
		footerGroup: 'Get involved',
		external: true,
	},
	{
		label: 'GitHub',
		href: 'https://github.com/Great-Falls-Tool-Bus',
		match: [],
		footerGroup: 'Get involved',
		external: true,
	},
	{ label: 'Privacy', href: '/privacy', match: ['/privacy'], footerGroup: 'Site' },
	{ label: 'Refund policy', href: '/refund-policy', match: ['/refund-policy'], footerGroup: 'Site' },
	{ label: 'Legal', href: '/legal', match: ['/legal'], footerGroup: 'Site' },
	// Same-origin resource, not an outbound destination, so a plain anchor.
	{ label: 'Sitemap', href: '/sitemap.xml', match: [], footerGroup: 'Site' },
];

/** Header bar items — derived, never hand-duplicated. */
export const primaryNavItems: NavItem[] = navItems.filter((item) => item.primary);

/** Footer-demoted items, grouped in `navItems` order within each group. */
export const footerNavGroups: Array<{ heading: string; items: NavItem[] }> = (
	['About', 'Get involved', 'Site'] as const
).map((heading) => ({
	heading,
	items: navItems.filter((item) => item.footerGroup === heading),
}));

/**
 * True when `pathname` (base-stripped, "/" for root) is at or under any of
 * `patterns`. Exact for "/", prefix for everything else. (Demo pattern.)
 */
export const isActivePath = (pathname: string, patterns: string[]): boolean => {
	for (const pattern of patterns) {
		if (pattern === '/') {
			if (pathname === '/') return true;
		} else if (pathname === pattern || pathname.startsWith(pattern + '/')) {
			return true;
		}
	}
	return false;
};
