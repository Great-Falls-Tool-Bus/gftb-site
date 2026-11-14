import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTEREST_PATH, JOIN_STEPS, MEMBER_INTAKE } from './membership';
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
	it('says applications are open, as the member app does', () => {
		expect(MEMBER_INTAKE).toBe('open');
		expect(INTEREST_PATH).toBe('/contact');
	});

	it('holds no member-app address and no link into /join in the nav registry', () => {
		for (const item of navItems) {
			expect(item.href, item.label).not.toMatch(/members\.greatfallstoolbus\.org/u);
			expect(item.href, item.label).not.toMatch(/^\/join(?:[/?#]|$)/u);
		}
		expect(navItems.some((item) => item.label === 'Join' || item.label === 'Member sign in')).toBe(false);
	});

	it('keeps member-app addresses out of every public source file, and /join links to the header and hero', () => {
		const sources = [
			'src/routes/+layout.svelte',
			'src/routes/+page.svelte',
			'src/routes/join/+page.svelte',
			'src/lib/nav-items.ts',
			'src/lib/membership.ts',
			'src/lib/components/GatedSlot.svelte',
			'src/lib/gated/surface.svelte.ts',
		];
		// Operator ruling 2026-11-14: exactly one plain /join anchor in the header
		// and one in the hero, each marked for the gated-join-link leak-scan rule.
		const sanctioned: Record<string, string> = {
			'src/routes/+layout.svelte': 'header',
			'src/routes/+page.svelte': 'hero',
		};
		for (const source of sources) {
			const text = read(source);
			expect(text, source).not.toMatch(/members\.greatfallstoolbus\.org/u);
			expect(text, source).not.toContain('membership-surface');
			const joinAnchors = text.match(/href=\{?["'`]?\/join/gu) ?? [];
			const marks = text.match(/data-public-join="(\w+)"/gu) ?? [];
			if (sanctioned[source]) {
				expect(joinAnchors, source).toHaveLength(1);
				expect(marks, source).toEqual([`data-public-join="${sanctioned[source]}"`]);
				expect(text, source).toMatch(new RegExp(`data-public-join="${sanctioned[source]}"\\s+href="/join/"`, 'u'));
			} else {
				expect(joinAnchors, source).toEqual([]);
				expect(marks, source).toEqual([]);
			}
		}
		// The manifest URL is the one place the member host appears in public code.
		expect(read('src/lib/gated/manifest.ts').match(/members\.greatfallstoolbus\.org/gu)).toHaveLength(1);
	});

	it('lists /join: in the sitemap and indexed, but out of the source map', () => {
		expect(read('src/routes/sitemap.xml/+server.ts')).toContain("'/join/'");
		expect(read('src/routes/+layout.svelte')).not.toMatch(/isUnlistedPath/u);
		expect(read('src/routes/+layout.svelte')).toMatch(/noindex=\{isErrorSurface\}/u);
		expect(JSON.parse(read('src/lib/generated/source-map.json')).routes['/join']).toBeUndefined();
	});
});
