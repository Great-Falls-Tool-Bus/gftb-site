// The public join path: where "Apply" and "Sign in" point, and whether
// applications are open. The member app is a separately owned service; this
// static site only links to it and never reads its state at runtime.
//
// MEMBER_INTAKE is the one switch. While it is 'closed', every Apply call to
// action leads to the on-site /join explanation and the contact route, never
// to the member app's application form. Flipping it to 'open' is a one-line
// change, made together with the member app opening intake.

/** Whether the member app accepts applications. */
export type MemberIntake = 'open' | 'closed';

export const MEMBER_INTAKE: MemberIntake = 'closed';

/** The member app's public origin. */
export const MEMBER_APP_ORIGIN = 'https://members.greatfallstoolbus.org';

/** The member app's application form. */
export const MEMBER_APPLY_URL = `${MEMBER_APP_ORIGIN}/apply`;

/** The member app's sign-in entry. */
export const MEMBER_SIGN_IN_URL = `${MEMBER_APP_ORIGIN}/login`;

/** The on-site page that explains how membership works. */
export const JOIN_PATH = '/join';

/**
 * True for pages that stay prerendered and reachable but unlisted while the
 * membership surface is behind its flag: noindex, and absent from the
 * sitemap and the source map.
 */
export function isUnlistedPath(pathname: string): boolean {
	return pathname === JOIN_PATH || pathname.startsWith(`${JOIN_PATH}/`);
}

/** Where an applicant goes while applications are closed. */
export const INTEREST_PATH = '/contact';

export interface JoinLink {
	href: string;
	label: string;
	/** True when the link leaves this site (render through ExternalLink). */
	external: boolean;
}

/** The Apply call to action for the given intake state. */
export function applyLink(intake: MemberIntake = MEMBER_INTAKE): JoinLink {
	return intake === 'open'
		? { href: MEMBER_APPLY_URL, label: 'Apply', external: true }
		: { href: JOIN_PATH, label: 'Apply', external: false };
}

/** The member sign-in link. It does not depend on the intake state. */
export function signInLink(): JoinLink {
	return { href: MEMBER_SIGN_IN_URL, label: 'Member sign in', external: true };
}

/** The steps every applicant takes, in order. */
export const JOIN_STEPS: readonly string[] = [
	'Apply with your name, an email address, and when you could visit. Members are adults 18 and older.',
	'Confirm your email address.',
	'A keyholder replies, usually within three business days, to arrange a tour.',
	'Take an in-person tour of the bus with a keyholder.',
	'A keyholder approves your application.',
	'Sign in to the member app and agree to the Member Agreement to become an active member.',
];
