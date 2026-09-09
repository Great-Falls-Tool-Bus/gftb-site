import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, roundRatio } from '../../../scripts/lib/color-contrast.mjs';
import { resolveRole, schemes } from '../../../scripts/lib/css-tokens.mjs';

// The notes are glass panes: the content-surface fill at 70% over whatever
// the scene paints (src/app.css `.goal-list > li`). The scene owes the text
// nothing (operator ruling at the M4 ratification: the former ink clamp
// darkened blocks under the copy and lagged the shoved notes), so the panes
// alone must carry the inks. This pin composites the pane over the two
// extremes any scene pixel can reach, black and white, with no help from the
// backdrop blur, and holds every glass role to its floor in both schemes.
// The browser row in e2e/home-goals.spec.ts measures the real composite.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const appCss = readFileSync(path.join(repoRoot, 'src/app.css'), 'utf8');
const themeCss = readFileSync(path.join(repoRoot, 'src/lib/styles/theme-gftb.css'), 'utf8');
const SCHEMES = schemes({ appCss, themeCss });

type Rgb = { red: number; green: number; blue: number; alpha: number };

const PANE_FILL = 0.7;

function paneFill(): number {
	const rule = /\.goal-list > li,\n\.goal-asides \{([^}]*)\}/u.exec(appCss);
	const match = rule && /color-mix\(in oklab, var\(--glass-panel\) (\d+)%, transparent\)/u.exec(rule[1]);
	return match ? Number(match[1]) / 100 : Number.NaN;
}

describe('the glass panes over the scene', () => {
	it('reads the pane fill it gates', () => {
		expect(paneFill()).toBe(PANE_FILL);
	});

	for (const scheme of Object.keys(SCHEMES)) {
		it(`keep every glass role on its floor over a black or a white scene (${scheme})`, () => {
			const tokens = SCHEMES[scheme as keyof typeof SCHEMES];
			const role = (name: string): Rgb => ({ ...(resolveRole(tokens, name) as Omit<Rgb, 'alpha'>), alpha: 1 });
			const panel = role('--glass-panel');
			const over = (scene: number): Rgb => ({
				red: Math.round(panel.red * PANE_FILL + scene * (1 - PANE_FILL)),
				green: Math.round(panel.green * PANE_FILL + scene * (1 - PANE_FILL)),
				blue: Math.round(panel.blue * PANE_FILL + scene * (1 - PANE_FILL)),
				alpha: 1,
			});
			const grounds = [over(0), over(255)];
			const worst = (name: string) => Math.min(...grounds.map((g) => roundRatio(contrastRatio(role(name), g))));
			expect(worst('--glass-fg'), 'body copy').toBeGreaterThanOrEqual(4.5);
			expect(worst('--glass-muted'), 'window copy').toBeGreaterThanOrEqual(4.5);
			expect(worst('--glass-link'), 'links').toBeGreaterThanOrEqual(4.5);
			expect(worst('--glass-heading'), 'titles (large)').toBeGreaterThanOrEqual(3);
		});
	}
});
