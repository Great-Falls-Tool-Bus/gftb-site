#!/usr/bin/env node
// Served-artifact proof for the tinyvectors pin (TIN-4339).
//
// MODULE.bazel pins the brand-vectors package; nothing else in this repo
// resolves it (no npm specifier, no lockfile entry). A build made outside the
// Bazel action can still resolve a stray node_modules/@tummycrypt/tinyvectors
// (a symlink, a stale pnpm store) and ship a different release's physics with
// every other check green. This script reads the built client chunks and
// proves the release that was actually bundled matches the pin, using each
// release's distinctive minified literal (its "tell").
//
// Usage: node scripts/check-served-tinyvectors.mjs <build-dir> [--module MODULE.bazel]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Per-release tells. `present` literals must all appear somewhere in the
 * built client JS; `absent` literals must appear nowhere. Keep one entry per
 * pinned release; a bump without an entry fails closed with guidance.
 */
export const TINYVECTORS_TELLS = {
	'0.3.7': {
		// The idle-drift cruise's per-blob drift speed (BlobPhysics.ts, 0.3.7).
		present: ['driftSpeed:.05+Math.random()*.05'],
		// The pre-cruise value shipped by 0.3.6 and earlier.
		absent: ['driftSpeed:.01+Math.random()*.015'],
	},
};

export function pinnedVersion(moduleBazel) {
	const match = /bazel_dep\(\s*name\s*=\s*"tummycrypt_tinyvectors"\s*,\s*version\s*=\s*"([^"]+)"/u.exec(moduleBazel);
	if (!match) throw new Error('MODULE.bazel does not pin tummycrypt_tinyvectors');
	return match[1];
}

function clientChunks(buildDir) {
	const root = join(buildDir, '_app', 'immutable');
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith('.js')) out.push(full);
		}
	};
	walk(root);
	return out;
}

/** Returns a list of problems; empty means the served artifact matches the pin. */
export function checkServedTinyvectors(buildDir, moduleBazel) {
	const version = pinnedVersion(moduleBazel);
	const tells = TINYVECTORS_TELLS[version];
	if (!tells) {
		return [
			`no served-artifact tell is registered for tummycrypt_tinyvectors ${version}; add its entry to scripts/check-served-tinyvectors.mjs (TINYVECTORS_TELLS) alongside the pin bump`,
		];
	}
	const chunks = clientChunks(buildDir);
	if (chunks.length === 0) return [`no client chunks under ${join(buildDir, '_app/immutable')}`];
	const sources = chunks.map((file) => [file, readFileSync(file, 'utf8')]);
	const problems = [];
	for (const literal of tells.present) {
		if (!sources.some(([, text]) => text.includes(literal))) {
			problems.push(
				`the built client never carries the ${version} tell ${JSON.stringify(literal)}: a different tinyvectors release was bundled`,
			);
		}
	}
	for (const literal of tells.absent) {
		const hit = sources.find(([, text]) => text.includes(literal));
		if (hit) problems.push(`${hit[0]} carries ${JSON.stringify(literal)}, a pre-${version} tinyvectors tell`);
	}
	return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
	const args = process.argv.slice(2);
	const buildDir = args.find((a) => !a.startsWith('--'));
	const moduleIndex = args.indexOf('--module');
	const modulePath = moduleIndex >= 0 ? args[moduleIndex + 1] : 'MODULE.bazel';
	if (!buildDir) {
		console.error('usage: check-served-tinyvectors.mjs <build-dir> [--module MODULE.bazel]');
		process.exit(2);
	}
	const moduleBazel = readFileSync(modulePath, 'utf8');
	const problems = checkServedTinyvectors(resolve(buildDir), moduleBazel);
	if (problems.length > 0) {
		for (const problem of problems) console.error(`served-tinyvectors: ${problem}`);
		process.exit(1);
	}
	console.log(
		`served-tinyvectors: the built client carries tinyvectors ${pinnedVersion(moduleBazel)} (MODULE.bazel pin)`,
	);
}
