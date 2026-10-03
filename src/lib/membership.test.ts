import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	INTEREST_PATH,
	JOIN_PATH,
	JOIN_STEPS,
	MEMBER_APPLY_URL,
	MEMBER_INTAKE,
	MEMBER_SIGN_IN_URL,
	applyLink,
	signInLink,
} from './membership';
import { membershipCopyViolations, visibleSourceText } from './membership-copy';
import { navItems } from './nav-items';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (relative: string) => readFileSync(path.join(ROOT, relative), 'utf8');

// The answer the public FAQ carried before this change, kept here only as
// the negative control: the invariant must reject it.
const RETIRED_ANSWER =
	"I'm glad you asked, we're always looking for more people to join the club! To become a member, you simply need " +
	'to donate money, gear, or tools. We are currently looking for pledges of at least $100 to recoup our startup ' +
	'costs.';

describe('membership copy invariant', () => {
	it('rejects the retired answer on every ground it broke', () => {
		const reasons = membershipCopyViolations(RETIRED_ANSWER).map((violation) => violation.reason);
		expect(reasons).toEqual(['condition', 'pledge']);
	});

	it.each([
		['a required payment', 'Members must pay $20 a month.'],
		['a donation condition', 'You need to donate a tool to join.'],
		['dues', 'Membership requires dues.'],
		['a pledge alone', 'We welcome pledges from neighbours.'],
		['a gear condition', 'To join, bring gear or tools.'],
	])('rejects %s', (_label, text) => {
		expect(membershipCopyViolations(text)).not.toEqual([]);
	});

	it.each([
		['the separation', 'Membership never depends on money, gear, or tools.'],
		['a $0 choice', 'Contributions are separate from membership, and $0 is always an option.'],
		['a question', 'Do I need to contribute money or tools to join?'],
		['an optional choice', 'Once you are a member you can choose to contribute money, including by cash or check.'],
		['the application steps', 'To join, you apply, take a tour, and a keyholder approves your application.'],
	])('accepts %s', (_label, text) => {
		expect(membershipCopyViolations(text)).toEqual([]);
	});

	it('holds over every public page source and the join steps', () => {
		const pages = [
			'src/routes/+page.svelte',
			'src/routes/join/+page.svelte',
			'src/lib/components/ContributeMenu.svelte',
		];
		for (const page of pages) {
			expect(membershipCopyViolations(visibleSourceText(read(page))), page).toEqual([]);
		}
		expect(membershipCopyViolations(JOIN_STEPS.join(' '))).toEqual([]);
	});

	it('holds over the published goals content', () => {
		const dir = 'src/content/goals';
		for (const file of readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith('.md'))) {
			expect(membershipCopyViolations(read(path.join(dir, file))), file).toEqual([]);
		}
	});
});

describe('join path', () => {
	it('keeps intake closed until the member app opens it', () => {
		expect(MEMBER_INTAKE).toBe('closed');
	});

	it('sends Apply to the on-site explanation while intake is closed', () => {
		expect(applyLink('closed')).toEqual({ href: JOIN_PATH, label: 'Apply', external: false });
		expect(applyLink()).toEqual(applyLink(MEMBER_INTAKE));
	});

	it('sends Apply to the member app application once intake is open', () => {
		expect(applyLink('open')).toEqual({ href: MEMBER_APPLY_URL, label: 'Apply', external: true });
	});

	it('points Sign in at the member app login in either state', () => {
		expect(signInLink()).toEqual({ href: MEMBER_SIGN_IN_URL, label: 'Member sign in', external: true });
	});

	it('targets the member app origin over https', () => {
		expect(MEMBER_APPLY_URL).toBe('https://members.greatfallstoolbus.org/apply');
		expect(MEMBER_SIGN_IN_URL).toBe('https://members.greatfallstoolbus.org/login');
		expect(INTEREST_PATH).toBe('/contact');
	});

	it('lists Join and Member sign in under Get involved', () => {
		const involved = navItems.filter((item) => item.footerGroup === 'Get involved');
		expect(involved.find((item) => item.label === 'Join')).toMatchObject({ href: JOIN_PATH });
		expect(involved.find((item) => item.label === 'Member sign in')).toMatchObject({
			href: MEMBER_SIGN_IN_URL,
			external: true,
		});
	});

	it('is in the sitemap and the source map', () => {
		expect(read('src/routes/sitemap.xml/+server.ts')).toContain("'/join/'");
		expect(JSON.parse(read('src/lib/generated/source-map.json')).routes['/join']).toBe('src/routes/join/+page.svelte');
	});
});
