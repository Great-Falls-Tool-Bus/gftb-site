/**
 * A dependency-free QR reader for the printed apex code in `static/qr/`.
 *
 * The printed code is the only part of the site a person cannot proofread, so
 * the acceptance suite decodes the shipped artefact rather than trusting the
 * `just qr-generate` recipe that produced it. Scope is deliberately narrow:
 * `qrencode --type=SVG --svg-path`, error-correction level H, byte mode. The
 * decoder throws with a precise message on anything outside that envelope
 * instead of silently returning a plausible string.
 *
 * No Reed-Solomon decoding happens here: a checked-in artefact either reads
 * cleanly or is wrong, and "repaired" bytes would hide exactly the corruption
 * this test exists to catch.
 *
 * Test-only, so it lives here rather than under `src/lib` (the SvelteKit
 * library root): nothing the site ships decodes QR codes, and a 300-line
 * decoder that cannot be imported by a route cannot be bundled by accident.
 * Plain ESM so `node` and `vitest` load the same bytes with no transpile step.
 */

/**
 * @typedef {'L' | 'M' | 'Q' | 'H'} QrErrorCorrectionLevel
 *
 * @typedef {object} QrSvgGeometry
 * @property {number} size Modules per side, e.g. 33 for a version-4 symbol.
 * @property {number} version QR version, 1..40.
 * @property {number} margin Quiet-zone modules on each side, as passed to `qrencode --margin`.
 * @property {number} viewBox `viewBox` extent; equals `size + 2 * margin` for a well-formed symbol.
 * @property {boolean[][]} modules `modules[row][column]`, true where the module is dark.
 *
 * @typedef {object} QrDecodeResult
 * @property {string} text
 * @property {number} version
 * @property {QrErrorCorrectionLevel} errorCorrectionLevel
 * @property {number} maskPattern
 * @property {number} byteLength Byte length declared by the symbol's character-count indicator.
 *
 * @typedef {object} BlockGroup
 * @property {number} blocks
 * @property {number} dataCodewords
 *
 * @typedef {object} EcBlockLayout
 * @property {number} ecCodewordsPerBlock
 * @property {BlockGroup[]} groups
 */

/**
 * ISO/IEC 18004 Table 9, level-H column, versions 1-10. `just qr-generate`
 * pins `--level=H`, so only that column is carried; any other level raises
 * rather than guessing at a layout this repository never produces.
 *
 * @type {Record<number, EcBlockLayout>}
 */
const LEVEL_H_BLOCKS = {
	1: { ecCodewordsPerBlock: 17, groups: [{ blocks: 1, dataCodewords: 9 }] },
	2: { ecCodewordsPerBlock: 28, groups: [{ blocks: 1, dataCodewords: 16 }] },
	3: { ecCodewordsPerBlock: 22, groups: [{ blocks: 2, dataCodewords: 13 }] },
	4: { ecCodewordsPerBlock: 16, groups: [{ blocks: 4, dataCodewords: 9 }] },
	5: {
		ecCodewordsPerBlock: 22,
		groups: [
			{ blocks: 2, dataCodewords: 11 },
			{ blocks: 2, dataCodewords: 12 },
		],
	},
	6: { ecCodewordsPerBlock: 28, groups: [{ blocks: 4, dataCodewords: 15 }] },
	7: {
		ecCodewordsPerBlock: 26,
		groups: [
			{ blocks: 4, dataCodewords: 13 },
			{ blocks: 1, dataCodewords: 14 },
		],
	},
	8: {
		ecCodewordsPerBlock: 26,
		groups: [
			{ blocks: 4, dataCodewords: 14 },
			{ blocks: 2, dataCodewords: 15 },
		],
	},
	9: {
		ecCodewordsPerBlock: 24,
		groups: [
			{ blocks: 4, dataCodewords: 12 },
			{ blocks: 4, dataCodewords: 13 },
		],
	},
	10: {
		ecCodewordsPerBlock: 28,
		groups: [
			{ blocks: 6, dataCodewords: 15 },
			{ blocks: 2, dataCodewords: 16 },
		],
	},
};

/**
 * ISO/IEC 18004 Table E.1 — alignment-pattern row/column centres, versions 1-10.
 *
 * @type {Record<number, number[]>}
 */
const ALIGNMENT_CENTERS = {
	1: [],
	2: [6, 18],
	3: [6, 22],
	4: [6, 26],
	5: [6, 30],
	6: [6, 34],
	7: [6, 22, 38],
	8: [6, 24, 42],
	9: [6, 26, 46],
	10: [6, 28, 50],
};

/** @type {Record<number, QrErrorCorrectionLevel>} */
const EC_LEVEL_BY_BITS = { 0b01: 'L', 0b00: 'M', 0b11: 'Q', 0b10: 'H' };

/** @type {Array<(row: number, column: number) => boolean>} */
const MASK_FUNCTIONS = [
	(row, column) => (row + column) % 2 === 0,
	(row) => row % 2 === 0,
	(_row, column) => column % 3 === 0,
	(row, column) => (row + column) % 3 === 0,
	(row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
	(row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
	(row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
	(row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

const SVG_PATH_RE = / d="([^"]+)"/u;
const VIEW_BOX_RE = /viewBox="0 0 (\d+) \1"/u;
const TRANSLATE_RE = /transform="translate\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\)"/u;
const RUN_RE = /M(\d+),(\d+)h(\d+)/gu;

/**
 * Parses the `qrencode --svg-path` document into a module matrix.
 *
 * `--svg-path` emits one `M{x},{y}h{run}` per horizontal run of dark modules,
 * stroked at unit width and translated by the quiet zone. The y translation
 * carries a half-module offset because the stroke is centred on the line.
 *
 * @param {string} svg
 * @returns {QrSvgGeometry}
 */
export function parseQrSvg(svg) {
	const viewBoxMatch = VIEW_BOX_RE.exec(svg);
	if (!viewBoxMatch) throw new Error('QR SVG: expected a square integer viewBox anchored at 0 0');
	const viewBox = Number(viewBoxMatch[1]);

	const translateMatch = TRANSLATE_RE.exec(svg);
	if (!translateMatch) throw new Error('QR SVG: expected a translate(x,y) quiet-zone offset on the module path');
	const marginX = Number(translateMatch[1]);
	const marginY = Number(translateMatch[2]);
	if (marginY - marginX !== 0.5) {
		throw new Error(`QR SVG: expected a half-module stroke offset, saw translate(${marginX},${marginY})`);
	}

	const pathMatch = SVG_PATH_RE.exec(svg);
	if (!pathMatch) throw new Error('QR SVG: no module path found');

	const size = viewBox - 2 * marginX;
	if (size < 21 || (size - 17) % 4 !== 0) throw new Error(`QR SVG: ${size} modules is not a valid QR symbol size`);
	const version = (size - 17) / 4;

	/** @type {boolean[][]} */
	const modules = Array.from({ length: size }, () => new Array(size).fill(false));
	RUN_RE.lastIndex = 0;
	let consumed = 0;
	for (let match = RUN_RE.exec(pathMatch[1]); match !== null; match = RUN_RE.exec(pathMatch[1])) {
		const column = Number(match[1]);
		const row = Number(match[2]);
		const run = Number(match[3]);
		if (row >= size || column + run > size) throw new Error(`QR SVG: run M${column},${row}h${run} leaves the symbol`);
		for (let offset = 0; offset < run; offset += 1) modules[row][column + offset] = true;
		consumed += match[0].length;
	}
	if (consumed !== pathMatch[1].length) throw new Error('QR SVG: module path contains commands beyond horizontal runs');

	return { size, version, margin: marginX, viewBox, modules };
}

/**
 * Re-serializes a module matrix the way `qrencode 4.1.1 --svg-path` does — one
 * `M{x},{y}h1` command per dark module, in row-major order, with no run
 * coalescing. A test can then prove the shipped path is a pure function of the
 * symbol and carries no incidental byte drift.
 *
 * @param {boolean[][]} modules
 * @returns {string}
 */
export function serializeQrPath(modules) {
	let path = '';
	for (let row = 0; row < modules.length; row += 1) {
		for (let column = 0; column < modules[row].length; column += 1) {
			if (modules[row][column]) path += `M${column},${row}h1`;
		}
	}
	return path;
}

/**
 * @param {number} row
 * @param {number} column
 * @param {number} size
 * @param {number} version
 * @returns {boolean}
 */
function isFunctionModule(row, column, size, version) {
	// Finder patterns with their separators (three 8x8 corner blocks).
	if (row <= 7 && column <= 7) return true;
	if (row <= 7 && column >= size - 8) return true;
	if (row >= size - 8 && column <= 7) return true;
	// Format information, including the always-dark module at (size - 8, 8).
	if (row === 8 && (column <= 8 || column >= size - 8)) return true;
	if (column === 8 && (row <= 8 || row >= size - 8)) return true;
	// Timing patterns.
	if (row === 6 || column === 6) return true;

	const centers = ALIGNMENT_CENTERS[version];
	if (!centers) throw new Error(`QR: alignment centres for version ${version} are not carried`);
	for (const centerRow of centers) {
		for (const centerColumn of centers) {
			const nearTopLeft = centerRow === 6 && centerColumn === 6;
			const nearTopRight = centerRow === 6 && centerColumn === size - 7;
			const nearBottomLeft = centerRow === size - 7 && centerColumn === 6;
			if (nearTopLeft || nearTopRight || nearBottomLeft) continue;
			if (Math.abs(row - centerRow) <= 2 && Math.abs(column - centerColumn) <= 2) return true;
		}
	}
	if (version >= 7 && ((row < 6 && column >= size - 11) || (column < 6 && row >= size - 11))) return true;
	return false;
}

/**
 * @param {boolean[][]} modules
 * @returns {{ errorCorrectionLevel: QrErrorCorrectionLevel; maskPattern: number }}
 */
function readFormatInformation(modules) {
	/** @type {Array<[number, number]>} */
	const positions = [
		[8, 0],
		[8, 1],
		[8, 2],
		[8, 3],
		[8, 4],
		[8, 5],
		[8, 7],
		[8, 8],
		[7, 8],
		[5, 8],
		[4, 8],
		[3, 8],
		[2, 8],
		[1, 8],
		[0, 8],
	];
	let raw = 0;
	for (const [row, column] of positions) raw = (raw << 1) | (modules[row][column] ? 1 : 0);
	const format = raw ^ 0x5412;

	const levelBits = (format >> 13) & 0b11;
	const errorCorrectionLevel = EC_LEVEL_BY_BITS[levelBits];
	const maskPattern = (format >> 10) & 0b111;
	if (!errorCorrectionLevel) throw new Error('QR: unreadable error-correction level in the format information');
	return { errorCorrectionLevel, maskPattern };
}

/**
 * @param {QrSvgGeometry} geometry
 * @param {number} maskPattern
 * @returns {number[]}
 */
function readCodewords(geometry, maskPattern) {
	const { size, version, modules } = geometry;
	const mask = MASK_FUNCTIONS[maskPattern];
	/** @type {number[]} */
	const codewords = [];
	let current = 0;
	let bitsRead = 0;
	let upward = true;

	for (let right = size - 1; right >= 1; right -= 2) {
		const rightColumn = right <= 6 ? right - 1 : right;
		for (let step = 0; step < size; step += 1) {
			const row = upward ? size - 1 - step : step;
			for (const column of [rightColumn, rightColumn - 1]) {
				if (isFunctionModule(row, column, size, version)) continue;
				const dark = modules[row][column] !== mask(row, column);
				current = (current << 1) | (dark ? 1 : 0);
				bitsRead += 1;
				if (bitsRead === 8) {
					codewords.push(current);
					current = 0;
					bitsRead = 0;
				}
			}
		}
		upward = !upward;
	}
	return codewords;
}

/**
 * @param {number[]} codewords
 * @param {EcBlockLayout} layout
 * @returns {number[]}
 */
function deinterleaveDataCodewords(codewords, layout) {
	/** @type {number[]} */
	const blockSizes = [];
	for (const group of layout.groups) {
		for (let index = 0; index < group.blocks; index += 1) blockSizes.push(group.dataCodewords);
	}
	const totalData = blockSizes.reduce((sum, count) => sum + count, 0);
	if (codewords.length < totalData) throw new Error('QR: symbol carries fewer codewords than its block layout needs');

	/** @type {number[][]} */
	const blocks = blockSizes.map(() => []);
	let cursor = 0;
	const longest = Math.max(...blockSizes);
	for (let index = 0; index < longest; index += 1) {
		for (let block = 0; block < blockSizes.length; block += 1) {
			if (index >= blockSizes[block]) continue;
			blocks[block].push(codewords[cursor]);
			cursor += 1;
		}
	}
	return blocks.flat();
}

/**
 * Decodes a byte-mode, level-H symbol produced by `just qr-generate`.
 *
 * @param {string} svg
 * @returns {QrDecodeResult}
 */
export function decodeQrSvg(svg) {
	const geometry = parseQrSvg(svg);
	const { errorCorrectionLevel, maskPattern } = readFormatInformation(geometry.modules);
	if (errorCorrectionLevel !== 'H') {
		throw new Error(`QR: only level H is carried by this repository, symbol declares ${errorCorrectionLevel}`);
	}
	const layout = LEVEL_H_BLOCKS[geometry.version];
	if (!layout) throw new Error(`QR: level-H block layout for version ${geometry.version} is not carried`);

	const data = deinterleaveDataCodewords(readCodewords(geometry, maskPattern), layout);
	/** @type {number[]} */
	const bits = [];
	for (const codeword of data) {
		for (let shift = 7; shift >= 0; shift -= 1) bits.push((codeword >> shift) & 1);
	}
	/** @param {number} count */
	const take = (count) => {
		if (bits.length < count) throw new Error('QR: symbol ended mid-field');
		return bits.splice(0, count).reduce((value, bit) => (value << 1) | bit, 0);
	};

	const mode = take(4);
	if (mode !== 0b0100) throw new Error(`QR: only byte mode is carried, symbol declares mode ${mode.toString(2)}`);
	// Versions 1-9 use an 8-bit character-count indicator in byte mode.
	const byteLength = take(geometry.version <= 9 ? 8 : 16);
	const bytes = new Uint8Array(byteLength);
	for (let index = 0; index < byteLength; index += 1) bytes[index] = take(8);

	return {
		text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
		version: geometry.version,
		errorCorrectionLevel,
		maskPattern,
		byteLength,
	};
}
