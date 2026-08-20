// Single source of truth for navigation, ported from the demo site's
// src/lib/nav-items.ts SSOT pattern (greatfallstoolbus.org@origin/main): the
// header bar and the grouped footer both render from this one array, so the
// two can never drift apart. Icons are deliberately not ported — this
// microsite ships no icon dependency.
//
// Scope note (ADR 0014 §1 / launch-authority-flow): this is the PUBLIC
// microsite. Platform-owned surfaces (/tools, /cells*, /cell-sheets*,
// /keyholders, /discuss) live in gftb-platform and are not navigation here.

export interface NavItem {
	label: string;
	href: string;
	/** Base-relative path patterns that light this item as the active section. */
	match: string[];
	/** Rendered in the header bar. */
	primary?: boolean;
	/** When not `primary`, which footer group this item is demoted into. */
	footerGroup?: 'About' | 'Get involved';
}

export const navItems: NavItem[] = [
	{ label: 'Log', href: '/log', match: ['/log'], primary: true },
	{ label: 'Contact', href: '/contact', match: ['/contact'], primary: true },
	// Footer-demoted rows. History is the home page's spec §3 row 7 anchor.
	{ label: 'History', href: '/#history', match: [], footerGroup: 'About' },
	{ label: 'Log archive', href: '/log', match: ['/log'], footerGroup: 'About' },
	{ label: 'Contact a keyholder', href: '/contact', match: ['/contact'], footerGroup: 'Get involved' },
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
