// The public join path's static facts. The header and hero Join links to /join
// are plain links in the served HTML (operator ruling 2026-11-14). The other
// membership links (Apply, Member sign in, How membership works, the footer
// Join) are not here: the member app serves them as a manifest from its own
// host, and <GatedSlot> renders them once it arrives (src/lib/gated/manifest.ts).
// This site holds no member-app address except the manifest URL.
//
// MEMBER_INTAKE only picks which public sentence the FAQ and /join show. The
// member app owns the real switch (the Apply link in its manifest points at the
// application form only while it is open), so flipping this to 'open' is made
// together with the member app opening intake.

/** Whether the member app accepts applications. */
export type MemberIntake = 'open' | 'closed';

export const MEMBER_INTAKE: MemberIntake = 'open';

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
