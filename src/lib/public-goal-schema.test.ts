import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseLogFrontmatter } from '../../scripts/lib/log-content.mjs';
import { assertPublicGoalMetadata } from './public-goal-schema';

const valid = {
	kind: 'goal',
	order: '10',
	title: 'Form the club',
	window: 'After September 4, 2026',
	cta_label: 'Go to Augusta with Jess',
	cta_href: '/contact',
	published: true,
	source: 'operator 2026-08-31',
};

describe('assertPublicGoalMetadata', () => {
	it('accepts a complete goal and normalizes order to a number', () => {
		expect(assertPublicGoalMetadata(valid).order).toBe(10);
	});

	it('rejects unknown kinds and unknown keys', () => {
		expect(() => assertPublicGoalMetadata({ ...valid, kind: 'card' })).toThrow(/kind/u);
		expect(() => assertPublicGoalMetadata({ ...valid, date: '2026-08-31' })).toThrow(/unsupported/u);
	});

	it('requires cta_label and cta_href together, and a safe href', () => {
		const { cta_href: _href, ...labelOnly } = valid;
		expect(() => assertPublicGoalMetadata(labelOnly)).toThrow(/travel together/u);
		expect(() => assertPublicGoalMetadata({ ...valid, cta_href: 'javascript:alert(1)' })).toThrow(/cta_href/u);
	});

	it('rejects em dashes in public copy', () => {
		expect(() => assertPublicGoalMetadata({ ...valid, title: 'Form the club — soon' })).toThrow(/em dash/u);
	});

	it('validates every file in src/content/goals', () => {
		const dir = path.resolve(__dirname, '../content/goals');
		const files = readdirSync(dir).filter((file) => file.endsWith('.md'));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const { metadata } = parseLogFrontmatter(readFileSync(path.join(dir, file), 'utf8'), file);
			expect(() => assertPublicGoalMetadata(metadata, file)).not.toThrow();
		}
	});
});
