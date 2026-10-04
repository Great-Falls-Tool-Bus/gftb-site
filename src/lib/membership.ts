// The public join path's static facts. The membership links themselves
// (Join, Apply, Member sign in, How membership works) are not here: the member
// app serves them as a manifest from its own host behind Cloudflare Access, and
// <GatedSlot> renders them only for someone with a session
// (src/lib/gated/manifest.ts). This site holds no member-app address except the
// manifest URL.
//
// MEMBER_INTAKE only picks which public sentence the FAQ and /join show. The
// member app owns the real switch (the Apply link in its manifest points at the
// application form only while it is open), so flipping this to 'open' is made
// together with the member app opening intake.

/** Whether the member app accepts applications. */
export type MemberIntake = 'open' | 'closed';

export const MEMBER_INTAKE: MemberIntake = 'closed';

/** The on-site explainer's path: still reachable and unlisted, but never linked from public markup. */
const JOIN_PATH = '/join';

/**
 * True for pages that stay prerendered and reachable but unlisted: noindex,
 * and absent from the sitemap and the source map.
 */
export function isUnlistedPath(pathname: string): boolean {
	return pathname === JOIN_PATH || pathname.startsWith(`${JOIN_PATH}/`);
}

/** Where an applicant goes while applications are closed. */
export const INTEREST_PATH = '/contact';

/** The steps every applicant takes, in order. */
export const JOIN_STEPS: readonly string[] = [
	'Apply with your name, an email address, and when you could visit. Members are adults 18 and older.',
	'Confirm your email address.',
	'A keyholder replies, usually within three business days, to arrange a tour.',
	'Take an in-person tour of the bus with a keyholder.',
	'A keyholder approves your application.',
	'Sign in to the member app and agree to the Member Agreement to become an active member.',
];
