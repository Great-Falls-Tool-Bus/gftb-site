#!/usr/bin/env node
/**
 * `just qa-packet` — capture the repeatable QA evidence packet for one build.
 *
 * The packet is the artefact a reviewer reads instead of re-running the suite by
 * hand: every prerendered route photographed at the acceptance widths, in both
 * colour schemes, at 200% zoom, with reduced motion, and with real keyboard
 * focus on the two controls the acceptance rows single out — plus a receipt
 * saying what the gates reported for the same tree.
 *
 * Determinism is the whole point, so every knob a browser can wobble on is
 * pinned here:
 *   - fixed viewport and `scale: 'css'`, so a retina laptop and a CI runner
 *     produce byte-comparable images;
 *   - `animations: 'disabled'` and `caret: 'hide'` at capture time;
 *   - `document.fonts.ready` awaited, so no screenshot catches a fallback face;
 *   - `waitForLoadState('networkidle')` before and after the widget settles;
 *   - every off-origin request aborted, and the one third party the page talks
 *     to (the separately owned contact API) answered from a fixed local stub, so
 *     a packet can never depend on the weather at another service.
 *
 * WHAT IS DELIBERATELY NOT RECORDED: the branch name. Branch names routinely
 * carry issue-tracker IDs, and the shared leak rules forbid those in anything
 * this repository emits. The head SHA identifies the packet; the branch adds
 * nothing a reviewer cannot get from the SHA.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { REPO_ROOT, scanText } from './lib/leak-scan.mjs';
import { parseQaPacketArguments, preparePacketDirectories } from './lib/qa-packet-paths.mjs';

/** The acceptance widths (spec §3), in CSS pixels. 320 is the WCAG 1.4.10 reflow floor. */
const NOMINAL_WIDTHS = [320, 375, 768, 1280];

/**
 * 200% zoom, expressed the way the acceptance suite expresses it: the layout
 * viewport a browser reports at 200% zoom is the physical device width halved.
 * The physical width is the single source of truth and the tested width is
 * derived from it, so the two can never drift apart.
 */
const ZOOM_CASES = [1280, 768, 640].map((physicalWidth) => ({ physicalWidth, width: physicalWidth / 2 }));

/** Both schemes are captured even where the page paints the same in each: "unchanged" is evidence too. */
const SCHEMES = ['light', 'dark'];

/** Reduced motion is proved at a phone width and a desktop width rather than at all seven. */
const REDUCED_MOTION_WIDTHS = [375, 1280];

/** The width the focus and reduced-motion rows are photographed at. */
const FOCUS_WIDTH = 1280;

/** The two controls the acceptance rows name by hand. */
const FOCUS_TARGETS = [
	{ route: '/', id: 'cta', description: 'primary call to action', role: 'link', name: 'Help build the bus' },
	{
		route: '/contact',
		id: 'contact-submit',
		description: 'contact form submit',
		role: 'button',
		name: 'Send to keyholders',
	},
];

const VIEWPORT_HEIGHT = 900;

/** The one third party the published page talks to. Answered locally; never reached. */
const FORM_ORIGIN = 'https://forms.latoolb.us';
const CHALLENGE_URL = `${FORM_ORIGIN}/api/challenge`;

/** A pre-solved ALTCHA challenge (sha256 of a five-character string), so the widget settles fast and identically. */
const SOLVABLE_CHALLENGE = {
	algorithm: 'SHA-256',
	challenge: 'bd7c911264aae15b66d4291b6850829aa96986b1d3ead34d1fdbfef27056c112',
	salt: 'test',
	signature: 'a'.repeat(64),
	maxnumber: 50,
};

/**
 * Substituted for the packet's own head SHA before the packet is leak-scanned.
 *
 * The shared rules treat any 40-character hex string as a repository pointer,
 * which is right for the PUBLISHED site and wrong for a packet whose entire
 * purpose is to say which commit it photographed. Exactly that one literal is
 * replaced; every other 40-hex string in the packet is still a finding.
 */
const HEAD_SHA_PLACEHOLDER = '<packet-head-sha>';

const SETTLE_TIMEOUT_MS = 15_000;
const SCREENSHOT_TIMEOUT_MS = 60_000;

/**
 * Every prerendered route, read recursively from the built tree rather than
 * from a hand-kept list. Nested log details therefore enter the LOOK packet
 * automatically, while SvelteKit internals remain excluded.
 *
 * @param {string} buildDirectory
 * @returns {string[]}
 */
function discoverRoutes(buildDirectory) {
	const routes = [];

	/**
	 * @param {string} directory
	 * @param {string[]} segments
	 */
	function walk(directory, segments) {
		const index = path.join(directory, 'index.html');
		if (statSync(index, { throwIfNoEntry: false })?.isFile()) {
			routes.push(segments.length === 0 ? '/' : `/${segments.join('/')}`);
		}

		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
			walk(path.join(directory, entry.name), [...segments, entry.name]);
		}
	}

	walk(buildDirectory, []);
	if (routes.length === 0) throw new Error(`qa-packet: no prerendered route with an index.html under ${buildDirectory}`);
	return routes.sort((a, b) => a.localeCompare(b));
}

/** @param {string} route */
function routeSlug(route) {
	return route === '/' ? 'root' : route.replace(/^\//u, '').replace(/\//gu, '-');
}

/**
 * The full capture matrix, as data. Reading this function is reading the packet.
 *
 * @param {string[]} routes
 */
function buildShotPlan(routes) {
	/** @type {Array<Record<string, unknown>>} */
	const shots = [];
	for (const route of routes) {
		const slug = routeSlug(route);
		for (const scheme of SCHEMES) {
			for (const width of NOMINAL_WIDTHS) {
				shots.push({
					id: `${slug}__w${width}__${scheme}`,
					route,
					width,
					physicalWidth: width,
					zoom: 1,
					scheme,
					reducedMotion: false,
					focus: null,
					note: `${width} CSS px`,
				});
			}
			for (const { physicalWidth, width } of ZOOM_CASES) {
				shots.push({
					id: `${slug}__zoom200-of${physicalWidth}__${scheme}`,
					route,
					width,
					physicalWidth,
					zoom: 2,
					scheme,
					reducedMotion: false,
					focus: null,
					note: `200% zoom on a ${physicalWidth} px device (${width} CSS px layout viewport)`,
				});
			}
			for (const width of REDUCED_MOTION_WIDTHS) {
				shots.push({
					id: `${slug}__w${width}__${scheme}__reduced-motion`,
					route,
					width,
					physicalWidth: width,
					zoom: 1,
					scheme,
					reducedMotion: true,
					focus: null,
					note: `${width} CSS px under prefers-reduced-motion: reduce`,
				});
			}
			for (const target of FOCUS_TARGETS.filter((candidate) => candidate.route === route)) {
				shots.push({
					id: `${slug}__w${FOCUS_WIDTH}__${scheme}__focus-${target.id}`,
					route,
					width: FOCUS_WIDTH,
					physicalWidth: FOCUS_WIDTH,
					zoom: 1,
					scheme,
					reducedMotion: false,
					focus: target,
					note: `keyboard focus on the ${target.description}`,
				});
			}
		}
	}
	return shots;
}

/**
 * Aborts everything off-origin, then answers the contact challenge locally.
 * Registered in that order because Playwright matches routes in reverse
 * registration order, so the specific handler wins.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} baseURL
 */
async function installNetworkHarness(context, baseURL) {
	const origin = new URL(baseURL).origin;
	/** @type {string[]} */
	const blocked = [];
	await context.route('**/*', async (route) => {
		const url = route.request().url();
		if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
			await route.continue();
			return;
		}
		blocked.push(url);
		await route.abort('blockedbyclient');
	});
	await context.route(CHALLENGE_URL, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': origin },
			body: JSON.stringify(SOLVABLE_CHALLENGE),
		});
	});
	return blocked;
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} the human-verification widget's settled state
 */
async function settle(page) {
	await page.waitForLoadState('networkidle');
	await page.evaluate(() => document.fonts.ready.then(() => true));
	await page
		.waitForFunction(() => window.__qaPacketWidgetState === 'verified', null, { timeout: SETTLE_TIMEOUT_MS })
		.catch(() => undefined);
	await page.waitForLoadState('networkidle');
	return page.evaluate(() => window.__qaPacketWidgetState ?? 'unobserved');
}

/**
 * Drives real keyboard focus onto a control by tabbing to it, because
 * `:focus-visible` is a statement about how focus arrived. A programmatic
 * `.focus()` would photograph a ring the keyboard user may never see.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ role: string; name: string }} target
 */
async function tabTo(page, target) {
	const locator = page.getByRole(/** @type {'link' | 'button'} */ (target.role), { name: target.name, exact: true });
	await locator.scrollIntoViewIfNeeded();
	await page.locator('body').press('Tab');
	for (let step = 0; step < 80; step += 1) {
		if (await locator.evaluate((element) => element === document.activeElement)) return locator;
		await page.keyboard.press('Tab');
	}
	throw new Error(`qa-packet: could not reach the ${target.name} control by Tab alone`);
}

/**
 * A viewport-relative clip around the focused control, padded so the ring is not
 * cropped and clamped so it can never fall outside the viewport.
 *
 * The page opts into `scroll-behavior: smooth`, so the scroll a browser performs
 * when focus lands on an off-screen control is ANIMATED: a box read immediately
 * after focus is the box from before the scroll, which is how this produced a
 * zero-height clip. Re-scrolling instantly and waiting for the box to stop
 * moving is what makes the clip the same on every run.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 */
async function focusClip(page, locator) {
	await locator.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
	let box = await locator.boundingBox();
	for (let settle = 0; settle < 20; settle += 1) {
		await page.waitForTimeout(50);
		const next = await locator.boundingBox();
		if (box && next && Math.abs(next.y - box.y) < 0.5 && Math.abs(next.x - box.x) < 0.5) {
			box = next;
			break;
		}
		box = next;
	}
	if (!box) throw new Error('qa-packet: the focused control has no box to photograph');

	const viewport = page.viewportSize() ?? { width: FOCUS_WIDTH, height: VIEWPORT_HEIGHT };
	const pad = 32;
	const left = Math.max(0, Math.floor(box.x - pad));
	const top = Math.max(0, Math.floor(box.y - pad));
	const right = Math.min(viewport.width, Math.ceil(box.x + box.width + pad));
	const bottom = Math.min(viewport.height, Math.ceil(box.y + box.height + pad));
	if (right <= left || bottom <= top) {
		throw new Error(
			`qa-packet: the focused control sits outside the viewport (box ${JSON.stringify(box)}, viewport ${JSON.stringify(viewport)})`,
		);
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}

/** @param {string} file */
function sha256Of(file) {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function readIfPresent(file) {
	if (!file) return '';
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return '';
	}
}

/**
 * The acceptance-suite receipt. Every number here is parsed out of what a gate
 * actually printed for this tree; nothing is asserted by this script.
 */
function collectReceipt(options) {
	const buildLog = readIfPresent(options.buildLog);
	const checkLog = readIfPresent(options.checkLog);

	const leakScanLine = (buildLog.match(/^leak-scan: .*$/gmu) ?? []).at(-1) ?? 'not captured';

	const gateResults = [...checkLog.matchAll(/^(\/\/\S+)\s+(?:\(cached\)\s+)?(PASSED|FAILED|TIMEOUT)\b/gmu)].map(
		(match) => ({ target: match[1], result: match[2] }),
	);
	const checkSummary = /^All checks passed\.$/mu.test(checkLog)
		? 'All checks passed.'
		: 'just check did not report a clean pass';

	let unitTotals = { files: 0, total: 0, passed: 0, failed: 0, skipped: 0, source: 'not captured' };
	// vitest colours its summary, and Bazel keeps the escape codes in the test log.
	const testLog = readIfPresent(path.join(REPO_ROOT, 'bazel-testlogs/unit_tests/test.log')).replace(
		/^[\[[0-9;]*m/gu,
		'',
	);
	const countIn = (segment, label) => Number((segment.match(new RegExp(`(\\d+) ${label}`, 'u')) ?? ['', '0'])[1]);
	const testsLine = testLog.match(/^\s*Tests\s+(.+?)\((\d+)\)\s*$/mu);
	const filesLine = testLog.match(/^\s*Test Files\s+(.+?)\((\d+)\)\s*$/mu);
	if (testsLine) {
		unitTotals = {
			files: filesLine ? Number(filesLine[2]) : 0,
			total: Number(testsLine[2]),
			passed: countIn(testsLine[1], 'passed'),
			failed: countIn(testsLine[1], 'failed'),
			skipped: countIn(testsLine[1], 'skipped'),
			source: 'bazel-testlogs/unit_tests/test.log',
		};
	}

	let e2eTotals = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, source: 'not captured' };
	const e2eRaw = readIfPresent(options.e2eJson);
	if (e2eRaw) {
		try {
			const report = JSON.parse(e2eRaw);
			e2eTotals = {
				expected: report.stats?.expected ?? 0,
				unexpected: report.stats?.unexpected ?? 0,
				flaky: report.stats?.flaky ?? 0,
				skipped: report.stats?.skipped ?? 0,
				source: 'playwright json reporter',
			};
		} catch {
			/* left as not captured */
		}
	}

	return { leakScan: leakScanLine, checkSummary, gates: gateResults, unit: unitTotals, e2e: e2eTotals };
}

/** @param {Record<string, unknown>} manifest */
function renderIndex(manifest) {
	const receipt = /** @type {ReturnType<typeof collectReceipt>} */ (manifest.receipt);
	const shots = /** @type {Array<Record<string, any>>} */ (manifest.shots);
	const lines = [];

	lines.push('# QA evidence packet');
	lines.push('');
	lines.push(`- head: \`${manifest.sha}\``);
	lines.push(`- captured: ${manifest.generatedAt}`);
	lines.push(`- worktree at capture: ${manifest.worktreeClean ? 'clean' : 'DIRTY (uncommitted changes)'}`);
	lines.push(`- routes: ${/** @type {string[]} */ (manifest.routes).map((route) => `\`${route}\``).join(', ')}`);
	lines.push(`- images: ${shots.length}`);
	lines.push('');
	lines.push(
		'Regenerate with `just qa-packet`. Compare two packets with `just qa-packet-diff <baseline> <candidate>`.',
	);
	lines.push('');

	lines.push('## Acceptance receipt');
	lines.push('');
	lines.push('| Gate | Result |');
	lines.push('| --- | --- |');
	lines.push(`| \`just check\` | ${receipt.checkSummary} |`);
	for (const gate of receipt.gates) lines.push(`| \`${gate.target}\` | ${gate.result} |`);
	lines.push(
		`| unit suite (vitest) | ${receipt.unit.passed} passed, ${receipt.unit.failed} failed, ${receipt.unit.skipped} skipped, ` +
			`across ${receipt.unit.files} files |`,
	);
	lines.push(
		`| browser acceptance suite (playwright) | ${receipt.e2e.expected} passed, ${receipt.e2e.unexpected} failed, ${receipt.e2e.flaky} flaky, ${receipt.e2e.skipped} skipped |`,
	);
	lines.push(`| leak-scan over the built tree | ${receipt.leakScan} |`);
	lines.push('');
	lines.push('The human row of the acceptance plan is not in this table and cannot be: a person still has to look.');
	lines.push('See `docs/qa-packet.md` for the annotated pass that sits on top of these images.');
	lines.push('');

	lines.push('## Images');
	lines.push('');
	lines.push('| Route | Condition | Scheme | Width (CSS px) | Image | sha256 |');
	lines.push('| --- | --- | --- | --- | --- | --- |');
	for (const shot of shots) {
		const condition = shot.focus
			? `keyboard focus: ${shot.focus.description}`
			: shot.reducedMotion
				? 'prefers-reduced-motion: reduce'
				: shot.zoom === 2
					? `200% zoom on a ${shot.physicalWidth} px device`
					: 'default';
		lines.push(
			`| \`${shot.route}\` | ${condition} | ${shot.scheme} | ${shot.width} | [\`${shot.file}\`](${shot.file}) | \`${shot.sha256.slice(0, 16)}…\` |`,
		);
	}
	lines.push('');

	lines.push('## How these images were made');
	lines.push('');
	lines.push('- Chromium, fixed viewport, `scale: css`, animations disabled and caret hidden at capture time.');
	lines.push('- Web fonts awaited (`document.fonts.ready`) and the network idle before and after the page settles.');
	lines.push('- Every off-origin request aborted; the contact challenge answered from a fixed local stub.');
	lines.push('- Focus shots reached the control by pressing Tab, so the ring is the one a keyboard user sees.');
	lines.push(
		'- The branch name is deliberately absent: branch names carry tracker IDs, which may not be emitted here.',
	);
	lines.push('');
	return `${lines.join('\n')}\n`;
}

/**
 * Runs the shared leak rules over the packet's own text output.
 *
 * @param {Array<{ path: string; text: string }>} files
 * @param {string} headSha
 */
function scanPacket(files, headSha) {
	return files.flatMap((file) =>
		scanText(file.path, headSha ? file.text.split(headSha).join(HEAD_SHA_PLACEHOLDER) : file.text),
	);
}

async function main() {
	const options = parseQaPacketArguments(process.argv.slice(2));
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const buildDirectory = path.resolve(repoRoot, options.buildDir);
	const baseURL = `http://127.0.0.1:${options.port}`;

	const sha = options.sha || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
	const worktreeClean =
		execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length === 0;

	const { packetRoot, shotsDirectory } = preparePacketDirectories(repoRoot, sha);

	const routes = discoverRoutes(buildDirectory);
	const plan = buildShotPlan(routes);

	const browser = await chromium.launch();
	/** @type {Set<string>} */
	const blockedHosts = new Set();
	const widgetStates = new Set();

	/**
	 * One shot, in its own browser context so no state leaks between conditions.
	 *
	 * @param {Record<string, any>} shot
	 * @param {string} file
	 */
	const captureShot = async (shot, file) => {
		const context = await browser.newContext({
			viewport: { width: shot.width, height: VIEWPORT_HEIGHT },
			deviceScaleFactor: 1,
			colorScheme: shot.scheme,
			reducedMotion: shot.reducedMotion ? 'reduce' : 'no-preference',
		});
		try {
			await context.addInitScript(() => {
				window.__qaPacketWidgetState = 'pending';
				document.addEventListener(
					'statechange',
					(event) => {
						const detail = /** @type {CustomEvent<{ state?: string }>} */ (event).detail;
						if (detail && typeof detail.state === 'string') window.__qaPacketWidgetState = detail.state;
					},
					true,
				);
			});
			const blocked = await installNetworkHarness(context, baseURL);
			const page = await context.newPage();
			await page.goto(`${baseURL}${shot.route}`, { waitUntil: 'domcontentloaded' });
			const widgetState = await settle(page);

			if (shot.focus) {
				const locator = await tabTo(page, shot.focus);
				await page.screenshot({
					path: file,
					clip: await focusClip(page, locator),
					animations: 'disabled',
					caret: 'hide',
					scale: 'css',
					timeout: SCREENSHOT_TIMEOUT_MS,
				});
			} else {
				await page.screenshot({
					path: file,
					fullPage: true,
					animations: 'disabled',
					caret: 'hide',
					scale: 'css',
					timeout: SCREENSHOT_TIMEOUT_MS,
				});
			}
			return { widgetState, blocked };
		} finally {
			await context.close();
		}
	};

	try {
		for (const shot of plan) {
			const file = path.join(shotsDirectory, `${shot.id}.png`);
			// One retry, on a fresh context: a local preview can drop a single
			// request under load, and a whole packet is too expensive to lose to it.
			// A shot that fails twice is a real failure and stops the run.
			let captured;
			for (let attempt = 1; ; attempt += 1) {
				try {
					captured = await captureShot(shot, file);
					break;
				} catch (error) {
					if (attempt >= 2) throw error;
					process.stderr.write(`qa-packet: retrying ${shot.id} after ${String(error).split('\n')[0]}\n`);
				}
			}

			widgetStates.add(captured.widgetState);
			shot.file = path.posix.join('shots', `${shot.id}.png`);
			shot.bytes = statSync(file).size;
			shot.sha256 = sha256Of(file);
			shot.widgetState = captured.widgetState;
			for (const url of captured.blocked) blockedHosts.add(new URL(url).host);
			process.stdout.write(`qa-packet: captured ${shot.id}\n`);
		}
	} finally {
		await browser.close();
	}

	const manifest = {
		packet: 'gftb-site-qa-evidence',
		manifestVersion: 1,
		sha,
		worktreeClean,
		generatedAt: new Date().toISOString(),
		previewPort: options.port,
		routes,
		matrix: {
			nominalWidths: NOMINAL_WIDTHS,
			zoomCases: ZOOM_CASES,
			schemes: SCHEMES,
			reducedMotionWidths: REDUCED_MOTION_WIDTHS,
			focusWidth: FOCUS_WIDTH,
			focusTargets: FOCUS_TARGETS.map((target) => ({
				route: target.route,
				id: target.id,
				description: target.description,
			})),
		},
		offOriginHostsBlocked: [...blockedHosts].sort(),
		widgetStatesObserved: [...widgetStates].sort(),
		receipt: collectReceipt(options),
		shots: plan,
	};

	const manifestText = `${JSON.stringify(manifest, null, '\t')}\n`;
	const indexText = renderIndex(manifest);

	const findings = scanPacket(
		[
			{ path: 'manifest.json', text: manifestText },
			{ path: 'INDEX.md', text: indexText },
		],
		sha,
	);
	if (findings.length > 0) {
		for (const finding of findings) {
			process.stderr.write(
				`${finding.file}:${finding.line}: [${finding.ruleId}] ${finding.description} — ${finding.excerpt}\n`,
			);
		}
		process.stderr.write(
			`qa-packet: ${findings.length} leak finding(s); INDEX.md and manifest.json were NOT written\n`,
		);
		process.exit(1);
	}

	writeFileSync(path.join(packetRoot, 'manifest.json'), manifestText);
	writeFileSync(path.join(packetRoot, 'INDEX.md'), indexText);

	process.stdout.write(
		`qa-packet: ${plan.length} image(s) for ${routes.length} route(s) under ${path.relative(repoRoot, packetRoot)}; ` +
			`INDEX.md and manifest.json are leak-scan clean\n`,
	);
}

await main();
