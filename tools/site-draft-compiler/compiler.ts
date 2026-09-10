/**
 * Server-only source computation. The caller must authenticate the canonical
 * GitHub repository and base commit/tree association, authorize the sender and
 * retain a durable effect plan before writing. This module does not fetch,
 * publish, grant consent, or certify a deployed build.
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { compile as compileMarkdown } from 'mdsvex';
import { parse as parseSvelte } from 'svelte/compiler';
import {
	assertPublicLogMetadata,
	PUBLIC_LOG_OPTIONAL_KEYS,
	PUBLIC_LOG_REQUIRED_KEYS,
	type PublicLogMetadata,
} from '../../src/lib/public-log-schema.js';
import { parseLogFrontmatter } from '../../scripts/lib/log-content.mjs';
import { renderLogManifest, renderSourceMap, resolveSourceRepository } from '../../scripts/lib/log-projection.mjs';
import { assertPublicLogText } from '../../scripts/lib/log-source-guard.mjs';
import { scanText } from '../../scripts/lib/leak-scan.mjs';

const REPOSITORY = 'Great-Falls-Tool-Bus/gftb-site';
const MANIFEST = 'src/lib/generated/log-manifest.ts';
const SOURCE_MAP = 'src/lib/generated/source-map.json';
const LOG_PATH = /^src\/content\/log\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.svx$/;
const OID = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TREE_FILES = 20_000;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const PUBLIC_LOG_KEYS = new Set<string>([...PUBLIC_LOG_REQUIRED_KEYS, ...PUBLIC_LOG_OPTIONAL_KEYS]);
const branded = new WeakSet<object>();

const TOOL_FILES = [
	'MODULE.bazel',
	'pnpm-lock.yaml',
	'package.json',
	'.prettierrc',
	'tools/site-draft-compiler/defs.bzl',
	'tools/site-draft-compiler/BUILD.bazel',
	'tools/site-draft-compiler/compiler.ts',
	'tools/site-draft-compiler/package.json',
	'src/lib/public-log-schema.ts',
	'src/lib/featured-image-schema.ts',
	'scripts/lib/log-content.mjs',
	'scripts/lib/log-projection.mjs',
	'scripts/lib/log-source-guard.mjs',
	'scripts/lib/featured-image.mjs',
	'scripts/lib/leak-scan.mjs',
	'scripts/lib/leak-scan-rules.json',
] as const;

const RUNTIME_FILES = [
	'package.json',
	'src/lib/public-log-schema.js',
	'src/lib/featured-image-schema.js',
	'scripts/lib/log-content.mjs',
	'scripts/lib/log-projection.mjs',
	'scripts/lib/log-source-guard.mjs',
	'scripts/lib/featured-image.mjs',
	'scripts/lib/leak-scan.mjs',
	'scripts/lib/leak-scan-rules.json',
] as const;

/**
 * The installed package owns the compiler implementation and packaging files.
 * These site-owned inputs must still match the authenticated canonical tree:
 * their schemas, transformations, deny rules and dependency graph determine
 * what the current site will accept. Content-only main changes need no repin.
 */
const SITE_SEMANTIC_FILES = [
	'MODULE.bazel',
	'pnpm-lock.yaml',
	'package.json',
	'.prettierrc',
	'src/lib/public-log-schema.ts',
	'src/lib/featured-image-schema.ts',
	'scripts/lib/log-content.mjs',
	'scripts/lib/log-projection.mjs',
	'scripts/lib/log-source-guard.mjs',
	'scripts/lib/featured-image.mjs',
	'scripts/lib/leak-scan.mjs',
	'scripts/lib/leak-scan-rules.json',
] as const;

export interface SiteTreeEntry {
	readonly path: string;
	readonly mode: '100644' | '100755' | '120000' | '160000';
	readonly oid: string;
}

export interface SiteSourceBlob {
	readonly path: string;
	readonly content: string;
}

export interface SiteDraftProjectionInput {
	readonly repository: typeof REPOSITORY;
	readonly repositoryId: string;
	readonly baseSha: string;
	readonly baseTreeSha: string;
	/** All leaves of the complete recursive Git tree, not a directory subset. */
	readonly tree: readonly SiteTreeEntry[];
	/** Every log plus both manifests and the three source/config JSON files. */
	readonly blobs: readonly SiteSourceBlob[];
	readonly candidate: Readonly<{ path: string; content: string; sha256: string }>;
}

export interface SiteDraftOutput {
	readonly path: string;
	readonly content: string;
	readonly sha256: string;
	readonly previousBlobSha: string | null;
}

export interface VerifiedSiteDraftCandidate {
	readonly repository: typeof REPOSITORY;
	readonly repositoryId: string;
	readonly baseSha: string;
	readonly baseTreeSha: string;
	readonly prospectiveTreeSha: string;
	/** SHA-256 of the complete, sorted prospective Git leaf inventory. */
	readonly candidateTreeSha256: string;
	readonly originalCandidate: Readonly<{ path: string; sha256: string }>;
	readonly date: string;
	readonly canonicalDayPath: string;
	/** Draft first, then log manifest, then source map, including unchanged files. */
	readonly files: readonly [SiteDraftOutput, SiteDraftOutput, SiteDraftOutput];
	readonly sourceInputs: readonly Readonly<{ path: string; oid: string; sha256: string }>[];
	readonly toolInputs: readonly Readonly<{ path: string; sha256: string }>[];
	readonly nodeVersion: string;
	readonly receiptSha256: string;
}

export class SiteDraftRefusal extends Error {
	constructor() {
		super('Site draft projection refused.');
		this.name = 'SiteDraftRefusal';
	}
}

export function assertVerifiedSiteDraftCandidate(value: unknown): asserts value is VerifiedSiteDraftCandidate {
	if (!value || typeof value !== 'object' || !branded.has(value)) throw new SiteDraftRefusal();
}

function requireFact(value: unknown): asserts value {
	if (!value) throw new SiteDraftRefusal();
}

function sha256(bytes: string | Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function gitObject(kind: string, bytes: Buffer): string {
	return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
}

function textBytes(value: unknown): asserts value is string {
	requireFact(
		typeof value === 'string' &&
			Buffer.byteLength(value) <= MAX_FILE_BYTES &&
			Buffer.from(value).toString('utf8') === value &&
			!value.includes('\0'),
	);
}

function validPath(value: unknown): asserts value is string {
	requireFact(
		typeof value === 'string' &&
			value.length > 0 &&
			value.length <= 512 &&
			Buffer.from(value).toString('utf8') === value &&
			!value.includes('\\') &&
			Array.from(value).every((character) => character.charCodeAt(0) > 0x1f && character.charCodeAt(0) !== 0x7f) &&
			value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
	);
}

type TreeNode = Map<string, TreeNode | SiteTreeEntry>;

/** Reconstruct Git's complete tree object, including unconsumed source paths. */
function treeOid(entries: readonly SiteTreeEntry[]): string {
	const root: TreeNode = new Map();
	for (const entry of entries) {
		validPath(entry.path);
		requireFact(OID.test(entry.oid) && ['100644', '100755', '120000', '160000'].includes(entry.mode));
		const parts = entry.path.split('/');
		let node = root;
		for (const part of parts.slice(0, -1)) {
			if (!node.has(part)) node.set(part, new Map());
			const child = node.get(part);
			requireFact(child instanceof Map);
			node = child;
		}
		const name = parts[parts.length - 1];
		requireFact(!node.has(name));
		node.set(name, entry);
	}
	const hash = (node: TreeNode): string => {
		const rows = [...node].map(([name, value]) => {
			const directory = value instanceof Map;
			const mode = directory ? '40000' : value.mode;
			const oid = directory ? hash(value) : value.oid;
			return {
				key: Buffer.from(name + (directory ? '/' : '')),
				bytes: Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex')]),
			};
		});
		rows.sort((left, right) => Buffer.compare(left.key, right.key));
		return gitObject('tree', Buffer.concat(rows.map((row) => row.bytes)));
	};
	return hash(root);
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
			.join(',')}}`;
	}
	const encoded = JSON.stringify(value);
	requireFact(encoded !== undefined);
	return encoded;
}

function freeze<T>(value: T): T {
	if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) freeze(item);
		Object.freeze(value);
	}
	return value;
}

function publicText(value: string): void {
	assertPublicLogText(value);
	requireFact(scanText('editorial-draft.svx', value).length === 0);
}

function parseEntry(path: string, content: string) {
	requireFact(LOG_PATH.test(path));
	const parsed = parseLogFrontmatter(content, path);
	const metadata = assertPublicLogMetadata(parsed.metadata, path);
	requireFact(path.startsWith(`src/content/log/${metadata.date}-`) && parsed.body.length > 0);
	const block = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
	requireFact(block);
	const keys = [...block.matchAll(/^([A-Za-z][\w-]*):/gm)].map((match) => match[1]);
	requireFact(
		new Set(keys).size === keys.length &&
			keys.every((key) => PUBLIC_LOG_KEYS.has(key)) &&
			/^published:\s*(?:true|false)$/m.test(block),
	);
	if (!metadata.published) requireFact(parsed.body.includes('TODO(jess)'));
	publicText(content);
	return {
		file: path.slice('src/content/log/'.length),
		slug: path.slice('src/content/log/'.length, -4),
		sourcePath: path,
		metadata: metadata as PublicLogMetadata & Record<string, unknown>,
		body: parsed.body,
	};
}

function astRecord(value: unknown): Record<string, unknown> {
	requireFact(value && typeof value === 'object' && !Array.isArray(value));
	return value as Record<string, unknown>;
}

/** Validate the pinned parser's public modern fragment shape. */
function inertFragment(value: unknown): void {
	const fragment = astRecord(value);
	requireFact(fragment.type === 'Fragment' && Array.isArray(fragment.nodes));
	for (const value of fragment.nodes) {
		const node = astRecord(value);
		if (node.type === 'Text') {
			requireFact(typeof node.data === 'string');
			publicText(node.data);
		} else if (node.type === 'Comment') {
			requireFact(typeof node.data === 'string' && node.data.includes('TODO(jess)'));
			publicText(node.data);
		} else {
			requireFact(
				node.type === 'RegularElement' &&
					(node.name === 'p' || node.name === 'br') &&
					Array.isArray(node.attributes) &&
					node.attributes.length === 0,
			);
			inertFragment(node.fragment);
		}
	}
}

function metadataScript(code: string): string {
	const root = astRecord(parseSvelte(code, { modern: true }));
	// The pinned parser initializes options/css to null and adds each script
	// field only when that script exists. Its unused internal js array is empty.
	requireFact(root.type === 'Root' && root.options === null && root.css === null && root.instance === undefined);
	inertFragment(root.fragment);
	const script = astRecord(root.module);
	requireFact(
		script.type === 'Script' &&
			script.context === 'module' &&
			typeof script.start === 'number' &&
			Number.isInteger(script.start) &&
			script.start >= 0 &&
			typeof script.end === 'number' &&
			Number.isInteger(script.end) &&
			script.end > script.start &&
			script.end <= code.length,
	);
	return code.slice(script.start, script.end);
}

/** Accept only inert prose from the mail renderer; never execute supplied SVX. */
async function checkCandidate(content: string, metadata: PublicLogMetadata): Promise<void> {
	const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(content)?.[0];
	requireFact(frontmatter);
	const result = await compileMarkdown(content);
	const control = await compileMarkdown(`${frontmatter}\n<p>Plain compiler control.</p>\n`);
	requireFact(
		result && control && isDeepStrictEqual(result.data?.fm, metadata) && isDeepStrictEqual(control.data?.fm, metadata),
	);
	// mdsvex owns one metadata module. Submitted prose may neither add a script
	// nor alter that exact module; a safe body with the same frontmatter pins it.
	requireFact(metadataScript(result.code) === metadataScript(control.code));
}

function toolCustody() {
	const packageRoot = new URL('../../', import.meta.url);
	const sourceRoot = new URL('source/', packageRoot);
	const contents = new Map(TOOL_FILES.map((path) => [path, readFileSync(new URL(path, sourceRoot))]));
	const files: Array<{ path: string; sha256: string }> = TOOL_FILES.map((path) => ({
		path,
		sha256: sha256(contents.get(path)!),
	}));
	files.push({ path: 'compiler-runtime', sha256: sha256(readFileSync(fileURLToPath(import.meta.url))) });
	for (const path of RUNTIME_FILES) {
		files.push({ path: `runtime/${path}`, sha256: sha256(readFileSync(new URL(path, packageRoot))) });
	}
	const siteInputs = SITE_SEMANTIC_FILES.map((path) => ({ path, oid: gitObject('blob', contents.get(path)!) }));
	return { files, siteInputs, format: contents.get('.prettierrc')!.toString('utf8') };
}

export async function prepareDraftProjection(input: SiteDraftProjectionInput): Promise<VerifiedSiteDraftCandidate> {
	try {
		// Copy all caller-controlled bytes and arrays before the first await.
		requireFact(
			input.repository === REPOSITORY &&
				typeof input.repositoryId === 'string' &&
				/^[1-9]\d{0,18}$/.test(input.repositoryId) &&
				typeof input.baseSha === 'string' &&
				OID.test(input.baseSha) &&
				typeof input.baseTreeSha === 'string' &&
				OID.test(input.baseTreeSha),
		);
		requireFact(
			Array.isArray(input.tree) &&
				input.tree.length > 0 &&
				input.tree.length <= MAX_TREE_FILES &&
				Array.isArray(input.blobs) &&
				input.blobs.length <= MAX_TREE_FILES,
		);
		const repositoryId = input.repositoryId,
			baseSha = input.baseSha,
			baseTreeSha = input.baseTreeSha;
		const tree = input.tree.map(({ path, mode, oid }) => ({ path, mode, oid }));
		const blobs = input.blobs.map(({ path, content }) => ({ path, content }));
		const candidate = { ...input.candidate };
		textBytes(candidate.content);
		validPath(candidate.path);
		requireFact(
			LOG_PATH.test(candidate.path) &&
				typeof candidate.sha256 === 'string' &&
				SHA256.test(candidate.sha256) &&
				sha256(candidate.content) === candidate.sha256,
		);
		requireFact(treeOid(tree) === baseTreeSha);
		const treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
		const required = new Set(['.prettierrc', 'tinyland.repo.json', 'package.json', MANIFEST, SOURCE_MAP]);
		for (const entry of tree) {
			if (/^src\/content\/log\/[^/]+\.svx$/.test(entry.path)) required.add(entry.path);
		}
		requireFact(blobs.length === required.size);
		const contents = new Map<string, string>();
		let bytes = 0;
		for (const blob of blobs) {
			textBytes(blob.content);
			requireFact(required.has(blob.path) && !contents.has(blob.path));
			const entry = treeByPath.get(blob.path);
			requireFact(entry?.mode === '100644' && entry.oid === gitObject('blob', Buffer.from(blob.content)));
			contents.set(blob.path, blob.content);
			bytes += Buffer.byteLength(blob.content);
		}
		requireFact(bytes <= MAX_INPUT_BYTES);
		const get = (path: string): string => {
			const content = contents.get(path);
			requireFact(content !== undefined);
			return content;
		};
		const custody = toolCustody();
		// A complete authenticated tree is sufficient for this check. Never fetch
		// or execute the canonical tree's code to compensate for a stale package.
		for (const source of custody.siteInputs) {
			const entry = treeByPath.get(source.path);
			requireFact(entry?.mode === '100644' && entry.oid === source.oid);
		}
		// Arbitrary Prettier plugins from a caller's source snapshot are not code inputs.
		requireFact(get('.prettierrc') === custody.format);
		const format = JSON.parse(custody.format);
		// Prettier resolves named plugins from cwd. Bind the reviewed plugin to
		// this installed package's dependency closure, never the worker checkout.
		requireFact(isDeepStrictEqual(format.plugins, ['prettier-plugin-svelte']));
		format.plugins = [createRequire(import.meta.url).resolve('prettier-plugin-svelte')];
		const repository = resolveSourceRepository(JSON.parse(get('tinyland.repo.json')), JSON.parse(get('package.json')));
		requireFact(repository.repoUrl === `https://github.com/${REPOSITORY}` && repository.branch === 'main');
		const entries = [...required]
			.filter((path) => LOG_PATH.test(path))
			.sort()
			.map((path) => parseEntry(path, get(path)));
		requireFact(entries.length === [...required].filter((path) => path.endsWith('.svx')).length);
		requireFact(new Set(entries.map((entry) => entry.metadata.date)).size === entries.length);
		for (const entry of entries) {
			if (entry.metadata.published && entry.metadata.image) {
				requireFact(treeByPath.get(`static${entry.metadata.image}`)?.mode === '100644');
			}
		}
		const incoming = parseEntry(candidate.path, candidate.content);
		requireFact(incoming.metadata.published === false);
		const pages = tree.filter((entry) => /^src\/routes\/(?:[^/]+\/)*\+page\.svelte$/.test(entry.path));
		requireFact(pages.every((entry) => entry.mode === '100644'));
		const pagePaths = pages.map((entry) => entry.path).sort();
		await checkCandidate(candidate.content, incoming.metadata);
		// Reject stale generated preimages before constructing an amendment.
		requireFact((await renderLogManifest(entries, format)) === get(MANIFEST));
		requireFact(renderSourceMap(repository, pagePaths, entries) === get(SOURCE_MAP));
		const previous = entries.find((entry) => entry.metadata.date === incoming.metadata.date);
		const canonicalDayPath = previous?.sourcePath ?? candidate.path;
		let content = candidate.content;
		if (previous) {
			const original = get(previous.sourcePath);
			// Preserve the exact original source except its explicit publication flag.
			const draft = previous.metadata.published
				? original.replace(/^published:\s*true$/m, 'published: false')
				: original;
			content = `${draft}\n\n${incoming.body}\n`;
		} else requireFact(!treeByPath.has(candidate.path));
		textBytes(content);
		const finalEntry = parseEntry(canonicalDayPath, content);
		const prospective = entries
			.filter((entry) => entry.sourcePath !== canonicalDayPath)
			.concat(finalEntry)
			.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
		const outputs = [
			content,
			await renderLogManifest(prospective, format),
			renderSourceMap(repository, pagePaths, prospective),
		];
		const paths = [canonicalDayPath, MANIFEST, SOURCE_MAP];
		const files = outputs.map((output, index) => {
			textBytes(output);
			return {
				path: paths[index],
				content: output,
				sha256: sha256(output),
				previousBlobSha: treeByPath.get(paths[index])?.oid ?? null,
			};
		}) as unknown as [SiteDraftOutput, SiteDraftOutput, SiteDraftOutput];
		const replacements = new Map(
			files.map((file) => [
				file.path,
				{ path: file.path, mode: '100644' as const, oid: gitObject('blob', Buffer.from(file.content)) },
			]),
		);
		const nextTree = tree.filter((entry) => !replacements.has(entry.path)).concat([...replacements.values()]);
		const sortedTree = [...nextTree].sort((left, right) =>
			left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
		);
		const facts = {
			repository: REPOSITORY,
			repositoryId,
			baseSha,
			baseTreeSha,
			prospectiveTreeSha: treeOid(nextTree),
			candidateTreeSha256: sha256(canonical(['gftb.site-draft-tree/1', sortedTree])),
			originalCandidate: { path: candidate.path, sha256: candidate.sha256 },
			date: incoming.metadata.date,
			canonicalDayPath,
			files,
			sourceInputs: blobs
				.map((blob) => ({ path: blob.path, oid: treeByPath.get(blob.path)!.oid, sha256: sha256(blob.content) }))
				.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
			toolInputs: custody.files,
			nodeVersion: process.version,
		} as const;
		const receiptFacts = {
			...facts,
			files: files.map(({ path, sha256: digest, previousBlobSha }) => ({ path, sha256: digest, previousBlobSha })),
		};
		const result = freeze({ ...facts, receiptSha256: sha256(canonical(receiptFacts)) });
		branded.add(result);
		return result;
	} catch {
		// Parser/scanner diagnostics can contain private source. Never export them.
		throw new SiteDraftRefusal();
	}
}
