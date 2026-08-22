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
 * Rendered in the header bar. The header bar renders a bare `<a>` (no
 * ExternalLink) for every primary item, so this variant cannot carry
 * `external` — the type forbids the combination review PR #35 EDIT-2 flagged
 * as comment-only and unenforced.
 */
interface HeaderNavItem extends NavItemBase {
	primary: true;
	footerGroup?: never;
	external?: never;
}

/** Demoted into a footer group instead of the header bar. */
interface FooterNavItem extends NavItemBase {
	primary?: never;
	/** Which footer group this item is demoted into. */
	footerGroup: 'About' | 'Get involved';
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
	// Footer-demoted rows. History is the home page's spec §3 row 7 anchor.
	{ label: 'History', href: '/#history', match: [], footerGroup: 'About' },
	{ label: 'Log archive', href: '/log', match: ['/log'], footerGroup: 'About' },
	{ label: 'Contact a keyholder', href: '/contact', match: ['/contact'], footerGroup: 'Get involved' },
	// Public HyperKitty archive UI for discuss@ (operator ask 2026-08-20). The
	// PRIVATE keyholders@ archive never gets a public link — see
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
		footerGroup: 'Get involved',
		external: true,
	},
];

/** Header bar items — derived, never hand-duplicated. */
export const primaryNavItems: NavItem[] = navItems.filter((item) => item.primary);

/** Footer-demoted items, grouped in `navItems` order within each group. */
export const footerNavGroups: Array<{ heading: string; items: NavItem[] }> = (['About', 'Get involved'] as const).map(
	(heading) => ({
		heading,
		items: navItems.filter((item) => item.footerGroup === heading),
	}),
);

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
