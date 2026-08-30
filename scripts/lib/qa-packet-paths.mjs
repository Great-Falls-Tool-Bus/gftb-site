import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const QA_PACKET_DIRECTORY = 'qa-packet';
export const HEAD_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

/** @param {string} sha */
export function validateHeadSha(sha) {
	if (!HEAD_SHA_PATTERN.test(sha)) {
		throw new Error('qa-packet: head SHA must be exactly 40 lowercase hexadecimal characters');
	}
	return sha;
}

/** @param {string[]} argv */
export function parseQaPacketArguments(argv) {
	const options = {
		port: 0,
		buildDir: 'build',
		sha: '',
		buildLog: '',
		checkLog: '',
		e2eJson: '',
	};
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		switch (flag) {
			case '--port':
				options.port = Number.parseInt(value, 10);
				index += 1;
				break;
			case '--build-dir':
				options.buildDir = value;
				index += 1;
				break;
			case '--sha':
				options.sha = validateHeadSha(value);
				index += 1;
				break;
			case '--build-log':
				options.buildLog = value;
				index += 1;
				break;
			case '--check-log':
				options.checkLog = value;
				index += 1;
				break;
			case '--e2e-json':
				options.e2eJson = value;
				index += 1;
				break;
			default:
				throw new Error(`qa-packet: unknown argument ${flag}`);
		}
	}
	if (!Number.isInteger(options.port) || options.port <= 0) {
		throw new Error('qa-packet: --port is required and must be a positive integer');
	}
	return options;
}

/**
 * Resolve the only permitted packet location. The SHA grammar makes traversal
 * impossible; the relative-path checks are a second, independent containment
 * assertion rather than relying on that grammar alone.
 *
 * @param {string} repoRoot
 * @param {string} sha
 */
export function resolvePacketPaths(repoRoot, sha) {
	const root = path.resolve(repoRoot);
	const packetBase = path.join(root, QA_PACKET_DIRECTORY);
	const packetRoot = path.join(packetBase, validateHeadSha(sha));
	const relative = path.relative(packetBase, packetRoot);

	if (
		packetRoot === root ||
		packetRoot === packetBase ||
		relative === '' ||
		relative === '..' ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative)
	) {
		throw new Error('qa-packet: packet root escaped its fixed repository directory');
	}

	return { packetBase, packetRoot, shotsDirectory: path.join(packetRoot, 'shots') };
}

/**
 * Create a new packet without deleting or reusing any path. Each mkdir is
 * non-recursive; an existing packet, non-directory base, or symlinked base
 * fails closed before a screenshot or receipt can be written.
 *
 * @param {string} repoRoot
 * @param {string} sha
 */
export function preparePacketDirectories(repoRoot, sha) {
	const paths = resolvePacketPaths(repoRoot, sha);
	const baseEntry = lstatSync(paths.packetBase, { throwIfNoEntry: false });
	if (baseEntry) {
		if (!baseEntry.isDirectory() || baseEntry.isSymbolicLink()) {
			throw new Error('qa-packet: fixed qa-packet base exists but is not a real directory');
		}
	} else {
		mkdirSync(paths.packetBase);
	}

	if (lstatSync(paths.packetRoot, { throwIfNoEntry: false })) {
		throw new Error(`qa-packet: packet already exists for ${sha}; refusing to replace it`);
	}
	mkdirSync(paths.packetRoot);
	mkdirSync(paths.shotsDirectory);
	return paths;
}

/**
 * @param {string[]} argv
 * @param {number} defaultThreshold
 */
export function parseQaPacketDiffArguments(argv, defaultThreshold) {
	const positional = [];
	let threshold = defaultThreshold;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === '--threshold') {
			threshold = Number.parseInt(argv[index + 1], 10);
			index += 1;
		} else if (argument.startsWith('-')) {
			throw new Error(`qa-packet-diff: unknown argument ${argument}`);
		} else {
			positional.push(argument);
		}
	}
	if (positional.length !== 2) {
		throw new Error('qa-packet-diff: expected <baseline-packet-dir> <candidate-packet-dir>');
	}
	if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
		throw new Error('qa-packet-diff: --threshold must be an integer between 0 and 255');
	}
	return { baseline: positional[0], candidate: positional[1], threshold };
}

/**
 * @param {string} directory
 * @param {string} label
 */
function requireRealDirectory(directory, label) {
	const entry = lstatSync(directory, { throwIfNoEntry: false });
	if (!entry?.isDirectory() || entry.isSymbolicLink()) {
		throw new Error(`qa-packet-diff: ${label} must be a real directory`);
	}
}

/**
 * Reject packet metadata that could steer either a read or a diff write
 * outside its packet. The generator emits this exact shots/<id>.png shape.
 *
 * @param {string} packetRoot
 * @param {any} value
 */
function validatePacketManifest(packetRoot, value) {
	if (!value || typeof value !== 'object' || !Array.isArray(value.shots)) {
		throw new Error('qa-packet-diff: packet manifest must contain a shots array');
	}

	const shotsRoot = path.join(packetRoot, 'shots');
	if (value.shots.length > 0) requireRealDirectory(shotsRoot, 'packet shots directory');
	const seen = new Set();
	for (const shot of value.shots) {
		if (!shot || typeof shot !== 'object' || typeof shot.id !== 'string' || !SHOT_ID_PATTERN.test(shot.id)) {
			throw new Error('qa-packet-diff: every shot id must use only lowercase letters, digits, underscores, or hyphens');
		}
		if (seen.has(shot.id)) throw new Error(`qa-packet-diff: duplicate shot id ${shot.id}`);
		seen.add(shot.id);

		const expectedFile = path.posix.join('shots', `${shot.id}.png`);
		if (shot.file !== expectedFile) {
			throw new Error(`qa-packet-diff: shot ${shot.id} has a non-fixed file path`);
		}
		const file = path.join(packetRoot, ...expectedFile.split('/'));
		const entry = lstatSync(file, { throwIfNoEntry: false });
		if (!entry?.isFile() || entry.isSymbolicLink() || path.dirname(realpathSync(file)) !== realpathSync(shotsRoot)) {
			throw new Error(`qa-packet-diff: shot ${shot.id} must be one real file inside its packet`);
		}
	}
	return value;
}

/**
 * Read one packet only after its caller-supplied path has been proved to be
 * exactly <repo>/qa-packet/<40hex>. The manifest SHA must match that carrier.
 *
 * @param {string} repoRoot
 * @param {string} input
 */
export function readFixedPacket(repoRoot, input) {
	const root = path.resolve(repoRoot);
	const packetBase = path.join(root, QA_PACKET_DIRECTORY);
	const requested = path.resolve(root, input);
	const relative = path.relative(packetBase, requested);

	if (relative.includes(path.sep) || path.isAbsolute(relative)) {
		throw new Error('qa-packet-diff: packet root must be one fixed qa-packet/<40hex> directory');
	}
	const sha = validateHeadSha(relative);
	const expected = resolvePacketPaths(root, sha).packetRoot;
	if (requested !== expected) {
		throw new Error('qa-packet-diff: packet root escaped the fixed qa-packet directory');
	}

	requireRealDirectory(packetBase, 'qa-packet base');
	requireRealDirectory(requested, 'packet root');
	if (path.dirname(realpathSync(requested)) !== realpathSync(packetBase)) {
		throw new Error('qa-packet-diff: packet root resolves outside the fixed qa-packet directory');
	}

	const parsed = JSON.parse(readFileSync(path.join(requested, 'manifest.json'), 'utf8'));
	const manifestSha = validateHeadSha(parsed.sha);
	if (manifestSha !== sha) {
		throw new Error('qa-packet-diff: manifest SHA does not match its fixed packet directory');
	}
	const manifest = validatePacketManifest(requested, parsed);
	return { root: requested, manifest };
}

/**
 * Derive and create the only permitted diff output. The fixed diff base and
 * final directory are real directories, never symlinks, and never replaced.
 *
 * @param {string} repoRoot
 * @param {string} baselineSha
 * @param {string} candidateSha
 */
export function prepareDiffDirectory(repoRoot, baselineSha, candidateSha) {
	const root = path.resolve(repoRoot);
	const packetBase = path.join(root, QA_PACKET_DIRECTORY);
	const baseline = validateHeadSha(baselineSha);
	const candidate = validateHeadSha(candidateSha);
	requireRealDirectory(packetBase, 'qa-packet base');

	const diffBase = path.join(packetBase, 'diff');
	const diffEntry = lstatSync(diffBase, { throwIfNoEntry: false });
	if (diffEntry) {
		if (!diffEntry.isDirectory() || diffEntry.isSymbolicLink()) {
			throw new Error('qa-packet-diff: fixed diff base exists but is not a real directory');
		}
	} else {
		mkdirSync(diffBase);
	}

	const outputName = `${baseline.slice(0, 12)}__${candidate.slice(0, 12)}`;
	const outputDirectory = path.join(diffBase, outputName);
	const relative = path.relative(diffBase, outputDirectory);
	if (
		outputDirectory === root ||
		outputDirectory === packetBase ||
		outputDirectory === diffBase ||
		relative !== outputName ||
		path.isAbsolute(relative)
	) {
		throw new Error('qa-packet-diff: diff output escaped its fixed directory');
	}
	if (lstatSync(outputDirectory, { throwIfNoEntry: false })) {
		throw new Error(`qa-packet-diff: output already exists for ${outputName}; refusing to replace it`);
	}
	mkdirSync(outputDirectory);
	return outputDirectory;
}
