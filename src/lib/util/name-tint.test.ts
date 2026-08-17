import { describe, expect, it } from 'vitest';
import { initials, nameTint } from './name-tint';

describe('nameTint', () => {
	it('is deterministic for the same name', () => {
		expect(nameTint('Ada Lovelace')).toEqual(nameTint('Ada Lovelace'));
	});

	it('is case- and whitespace-insensitive', () => {
		expect(nameTint('  ADA lovelace ').hue).toBe(nameTint('ada lovelace').hue);
	});

	it('produces a hue in [0, 360)', () => {
		for (const name of ['a', 'Grace Hopper', 'zzzzzz', 'Great Falls', '42']) {
			const { hue } = nameTint(name);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});

	it('distributes distinct names across different hues', () => {
		const names = ['Ada', 'Grace', 'Katherine', 'Dorothy', 'Mary', 'Annie'];
		const hues = new Set(names.map((n) => nameTint(n).hue));
		// Not a strict guarantee, but a healthy hash should not collapse six short
		// distinct names to one or two hues.
		expect(hues.size).toBeGreaterThanOrEqual(4);
	});

	it('emits usable hsl strings', () => {
		const tint = nameTint('Ada Lovelace');
		expect(tint.background).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
		expect(tint.foreground).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
	});

	it('honors saturation/lightness overrides', () => {
		expect(nameTint('Ada', { saturation: 40, lightness: 90 }).background).toBe(`hsl(${nameTint('Ada').hue} 40% 90%)`);
	});
});

describe('initials', () => {
	it('takes first+last initial for multi-word names', () => {
		expect(initials('Ada Lovelace')).toBe('AL');
		expect(initials('Katherine Grace Johnson')).toBe('KJ');
	});

	it('takes up to two letters for single-word names', () => {
		expect(initials('Ada')).toBe('AD');
		expect(initials('X')).toBe('X');
	});

	it('falls back to ? for empty input', () => {
		expect(initials('   ')).toBe('?');
	});
});
