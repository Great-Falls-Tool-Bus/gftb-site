// The membership copy invariant: nothing on the public site may make
// membership depend on paying, donating, or pledging. Membership comes from
// an application, a tour, and a keyholder's approval; a contribution is
// optional, separate, and may be $0. The unit test applies this to the page
// sources and the acceptance spec applies it to the rendered pages, so a
// regression fails in both places.

/** One sentence that conditions membership on money, gear, or a pledge. */
export interface MembershipCopyViolation {
	sentence: string;
	reason: 'pledge' | 'amount' | 'condition';
}

const PLEDGE = /\bpledg(?:e|es|ed|ing)\b/iu;
/** Any dollar amount other than $0. */
const AMOUNT = /\$\s?(?!0\b)\d/u;
const MEMBERSHIP = /\b(?:member(?:s|ship)?|join(?:s|ed|ing)?|apply|application|sign(?:ing)? up)\b/iu;
const MONEY =
	/\b(?:donat(?:e|es|ed|ing|ion|ions)|pay(?:s|ing|ment|ments)?|paid|dues|fees?|contribut(?:e|es|ed|ing|ion|ions)|money|gear|tools?)\b/iu;
const REQUIREMENT =
	/\b(?:must|need(?:s)? to|required?|requires|have to|has to|in order to|simply|only if|as long as|to become a member|to join)\b/iu;
const NEGATION = /\b(?:never|not|no|without|optional|voluntary|separate)\b|\$0\b/iu;

/** Split prose into sentences (good enough for page copy). */
export function sentences(text: string): string[] {
	return text
		.replace(/\s+/gu, ' ')
		.split(/(?<=[.!?])\s+/u)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
}

/**
 * Sentences that condition membership on money, gear, tools, or a pledge.
 * A pledge, or a non-zero dollar amount beside membership, is always a
 * violation. Otherwise a sentence fails when it names membership, money or
 * goods, and a requirement together, without a negation. Questions are
 * skipped: "Do I have to pay to join?" asks, it does not require.
 */
export function membershipCopyViolations(text: string): MembershipCopyViolation[] {
	const found: MembershipCopyViolation[] = [];
	for (const sentence of sentences(text)) {
		if (PLEDGE.test(sentence)) {
			found.push({ sentence, reason: 'pledge' });
		} else if (AMOUNT.test(sentence) && MEMBERSHIP.test(sentence)) {
			found.push({ sentence, reason: 'amount' });
		} else if (
			!sentence.endsWith('?') &&
			MEMBERSHIP.test(sentence) &&
			MONEY.test(sentence) &&
			REQUIREMENT.test(sentence) &&
			!NEGATION.test(sentence)
		) {
			found.push({ sentence, reason: 'condition' });
		}
	}
	return found;
}

/** Visible text of a Svelte or HTML source: no script, style, comments, or tags. */
export function visibleSourceText(source: string): string {
	return source
		.replace(/<script[\s\S]*?<\/script>/giu, ' ')
		.replace(/<style[\s\S]*?<\/style>/giu, ' ')
		.replace(/<!--[\s\S]*?-->/gu, ' ')
		.replace(/\{[#:/@][^}]*\}/gu, ' ')
		.replace(/<[^>]+>/gu, ' ')
		.replace(/&amp;/gu, '&')
		.replace(/&nbsp;/gu, ' ');
}
