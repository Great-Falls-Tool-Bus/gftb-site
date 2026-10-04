// Fixture manifest for reviewer and dev builds (PUBLIC_MEMBERSHIP_FIXTURE=1).
// Imported dynamically behind the build flag in surface.svelte.ts, so a normal
// build drops this module and none of these links reach the public bundle.
import type { SurfaceItem } from './manifest';

const SITE = 'https://greatfallstoolbus.org';
const MEMBERS = 'https://members.greatfallstoolbus.org';

export const FIXTURE_ITEMS: SurfaceItem[] = [
	{ slot: 'header-join', kind: 'join', label: 'Join', href: `${SITE}/join` },
	{ slot: 'faq-actions', kind: 'apply', label: 'Apply', href: `${SITE}/join` },
	{ slot: 'faq-actions', kind: 'sign-in', label: 'Member sign in', href: `${MEMBERS}/login` },
	{ slot: 'how-membership', kind: 'how-membership', label: 'How membership works', href: `${SITE}/join` },
	{ slot: 'footer-join', kind: 'join', label: 'Join', href: `${SITE}/join` },
	{ slot: 'footer-sign-in', kind: 'sign-in', label: 'Member sign in', href: `${MEMBERS}/login` },
	{ slot: 'join-sign-in', kind: 'sign-in', label: 'Member sign in', href: `${MEMBERS}/login` },
];

export async function loadFixture(): Promise<SurfaceItem[]> {
	return FIXTURE_ITEMS;
}
