// Membership requires an application, a tour and a keyholder’s approval. A contribution is
// optional and may be $0. Check source and rendered copy for wording that ties membership to
// payment.

/** A sentence that makes membership depend on a contribution. */
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
 * Flag pledges and nonzero amounts beside membership. Otherwise match a membership term, a
 * contribution and a requirement together, unless negated. Skip questions.
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

/** Extract visible text from Svelte or HTML for the copy check. */
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
