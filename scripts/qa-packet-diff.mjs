#!/usr/bin/env node
/**
 * `just qa-packet-diff` — per-image pixel diff between two QA evidence packets.
 *
 * WHY THERE IS NO IMAGE LIBRARY HERE: `pixelmatch` and `pngjs` are not in this
 * repository's dependency tree, and a QA convenience is not a good reason to add
 * two transitive dependencies to a site whose whole posture is "ship less".
 * Chromium is already a first-class, pinned tool here (the browser acceptance
 * suite runs on it), and a browser is a complete, well-tested PNG decoder and
 * encoder. So the comparison runs inside the same Chromium the packet was
 * captured with: both images are decoded to `ImageData`, compared channel by
 * channel, and the diff is re-encoded as a PNG. Nothing is added to
 * package.json.
 *
 * Output: `qa-packet/diff/<baseline-short>__<candidate-short>/` containing one
 * `<shot-id>.diff.png` per CHANGED image (unchanged pairs produce no file, so
 * the directory listing is the finding) and a `DIFF.md` summary.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { parseQaPacketDiffArguments, prepareDiffDirectory, readFixedPacket } from './lib/qa-packet-paths.mjs';

/**
 * A pixel counts as changed when any channel moves by more than this. Zero would
 * be defensible for two runs of the same pinned browser, but a small tolerance
 * keeps a font-hinting or GPU-rounding wobble from being reported as a visual
 * regression while still catching every real colour, layout, or content change.
 */
const DEFAULT_CHANNEL_THRESHOLD = 8;

/**
 * @param {string} directory
 * @param {string} repoRoot
 */
function readPacket(directory, repoRoot) {
	const { root, manifest } = readFixedPacket(repoRoot, directory);
	return { root, manifest, shots: new Map(manifest.shots.map((shot) => [shot.id, shot])) };
}

/** @param {string} file */
function toDataUrl(file) {
	return `data:image/png;base64,${readFileSync(file).toString('base64')}`;
}

/**
 * Decodes both images in the page, compares them, and returns the counts plus a
 * PNG data URL of the diff (candidate, desaturated and dimmed, with every
 * changed pixel painted magenta).
 *
 * @param {import('@playwright/test').Page} page
 */
async function comparePair(page, baselineUrl, candidateUrl, threshold) {
	return page.evaluate(
		async ({ baselineUrl, candidateUrl, threshold }) => {
			const load = async (url) => {
				const blob = await (await fetch(url)).blob();
				const bitmap = await createImageBitmap(blob);
				const canvas = document.createElement('canvas');
				canvas.width = bitmap.width;
				canvas.height = bitmap.height;
				const context = canvas.getContext('2d', { willReadFrequently: true });
				context.drawImage(bitmap, 0, 0);
				return {
					width: bitmap.width,
					height: bitmap.height,
					data: context.getImageData(0, 0, canvas.width, canvas.height).data,
				};
			};

			const baseline = await load(baselineUrl);
			const candidate = await load(candidateUrl);
			const width = Math.max(baseline.width, candidate.width);
			const height = Math.max(baseline.height, candidate.height);

			const output = document.createElement('canvas');
			output.width = width;
			output.height = height;
			const outputContext = output.getContext('2d');
			const image = outputContext.createImageData(width, height);

			const at = (source, x, y) => {
				if (x >= source.width || y >= source.height) return null;
				const offset = (y * source.width + x) * 4;
				return [source.data[offset], source.data[offset + 1], source.data[offset + 2], source.data[offset + 3]];
			};

			let changed = 0;
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					const before = at(baseline, x, y);
					const after = at(candidate, x, y);
					const offset = (y * width + x) * 4;
					const outside = before === null || after === null;
					const delta = outside
						? 255
						: Math.max(
								Math.abs(before[0] - after[0]),
								Math.abs(before[1] - after[1]),
								Math.abs(before[2] - after[2]),
								Math.abs(before[3] - after[3]),
							);
					if (delta > threshold) {
						changed += 1;
						image.data[offset] = 255;
						image.data[offset + 1] = 0;
						image.data[offset + 2] = 255;
						image.data[offset + 3] = 255;
					} else {
						// `after` is non-null here: a missing pixel makes `outside` true, which
						// forces delta 255 — but a caller may set --threshold 255, so read defensively.
						const pixel = after ?? [255, 255, 255, 255];
						const grey = (pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114) * 0.35 + 165;
						image.data[offset] = grey;
						image.data[offset + 1] = grey;
						image.data[offset + 2] = grey;
						image.data[offset + 3] = 255;
					}
				}
			}
			outputContext.putImageData(image, 0, 0);
			return {
				width,
				height,
				baselineSize: [baseline.width, baseline.height],
				candidateSize: [candidate.width, candidate.height],
				changed,
				total: width * height,
				diffPng: changed > 0 ? output.toDataURL('image/png') : '',
			};
		},
		{ baselineUrl, candidateUrl, threshold },
	);
}

function renderDiffMarkdown(summary) {
	const lines = [];
	lines.push('# QA evidence packet diff');
	lines.push('');
	lines.push(`- baseline head: \`${summary.baselineSha}\``);
	lines.push(`- candidate head: \`${summary.candidateSha}\``);
	lines.push(`- changed-pixel threshold: any channel moving by more than ${summary.threshold}/255`);
	lines.push(`- image pairs compared: ${summary.rows.length}`);
	lines.push(`- images changed: ${summary.changedCount}`);
	lines.push('');

	if (summary.onlyInBaseline.length > 0) {
		lines.push(`Only in the baseline packet: ${summary.onlyInBaseline.map((id) => `\`${id}\``).join(', ')}`);
		lines.push('');
	}
	if (summary.onlyInCandidate.length > 0) {
		lines.push(`Only in the candidate packet: ${summary.onlyInCandidate.map((id) => `\`${id}\``).join(', ')}`);
		lines.push('');
	}

	const changed = summary.rows.filter((row) => row.changed > 0);
	lines.push('## Changed images');
	lines.push('');
	if (changed.length === 0) {
		lines.push('None. Every compared image is pixel-identical within the threshold.');
	} else {
		lines.push('| Image | Pixels changed | % changed | Baseline size | Candidate size | Diff |');
		lines.push('| --- | --- | --- | --- | --- | --- |');
		for (const row of changed) {
			lines.push(
				`| \`${row.id}\` | ${row.changed} | ${row.percent.toFixed(2)}% | ${row.baselineSize.join('x')} | ` +
					`${row.candidateSize.join('x')} | [\`${row.diffFile}\`](${row.diffFile}) |`,
			);
		}
	}
	lines.push('');

	const unchanged = summary.rows.filter((row) => row.changed === 0);
	lines.push(`## Unchanged images (${unchanged.length})`);
	lines.push('');
	lines.push(unchanged.length === 0 ? 'None.' : unchanged.map((row) => `\`${row.id}\``).join(', '));
	lines.push('');
	lines.push('Magenta marks a changed pixel; everything else is the candidate image dimmed to grey.');
	lines.push('');
	return `${lines.join('\n')}\n`;
}

async function main() {
	const options = parseQaPacketDiffArguments(process.argv.slice(2), DEFAULT_CHANNEL_THRESHOLD);
	const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const baseline = readPacket(options.baseline, repoRoot);
	const candidate = readPacket(options.candidate, repoRoot);

	const outputDirectory = prepareDiffDirectory(repoRoot, baseline.manifest.sha, candidate.manifest.sha);

	const shared = [...baseline.shots.keys()].filter((id) => candidate.shots.has(id)).sort();
	const onlyInBaseline = [...baseline.shots.keys()].filter((id) => !candidate.shots.has(id)).sort();
	const onlyInCandidate = [...candidate.shots.keys()].filter((id) => !baseline.shots.has(id)).sort();

	const browser = await chromium.launch();
	const rows = [];
	try {
		const page = await browser.newPage();
		await page.goto('about:blank');
		for (const id of shared) {
			const result = await comparePair(
				page,
				toDataUrl(path.join(baseline.root, baseline.shots.get(id).file)),
				toDataUrl(path.join(candidate.root, candidate.shots.get(id).file)),
				options.threshold,
			);
			let diffFile = '';
			if (result.changed > 0) {
				diffFile = `${id}.diff.png`;
				writeFileSync(path.join(outputDirectory, diffFile), Buffer.from(result.diffPng.split(',')[1], 'base64'));
			}
			rows.push({
				id,
				changed: result.changed,
				total: result.total,
				percent: (result.changed / result.total) * 100,
				baselineSize: result.baselineSize,
				candidateSize: result.candidateSize,
				diffFile,
			});
			process.stdout.write(
				`qa-packet-diff: ${id} — ${result.changed}/${result.total} px (${((result.changed / result.total) * 100).toFixed(2)}%)\n`,
			);
		}
	} finally {
		await browser.close();
	}

	rows.sort((left, right) => right.percent - left.percent || left.id.localeCompare(right.id));
	const summary = {
		baselineSha: baseline.manifest.sha,
		candidateSha: candidate.manifest.sha,
		threshold: options.threshold,
		rows,
		onlyInBaseline,
		onlyInCandidate,
		changedCount: rows.filter((row) => row.changed > 0).length,
	};
	writeFileSync(path.join(outputDirectory, 'DIFF.md'), renderDiffMarkdown(summary));

	process.stdout.write(
		`qa-packet-diff: ${summary.changedCount} of ${rows.length} image(s) changed; ` +
			`summary at ${path.relative(repoRoot, path.join(outputDirectory, 'DIFF.md'))}\n`,
	);
}

await main();
