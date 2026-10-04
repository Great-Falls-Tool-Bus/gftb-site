// Readers for the stable Bazel status that scripts/bazel/workspace-status.sh
// writes. One implementation for the stamped Vite build (run-vite-build.mjs)
// and the stamped leak scan (check-build-output.mjs), so the two can never read
// the tailnet probe URL differently. Unit-tested in
// scripts/lib/tailnet-probe-stamp.test.mts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The marker workspace-status.sh stamps for an unset value. */
export const EMPTY_MARKER = '__EMPTY__';
/**
 * The marker workspace-status.sh stamps for a malformed PUBLIC_TAILNET_PROBE_URL.
 * It never stamps the malformed value itself, and it does not fail the status
 * command, so unrelated Bazel targets keep building; the two stamped consumers
 * fail instead.
 */
export const INVALID_MARKER = '__INVALID__';
export const TAILNET_PROBE_KEY = 'STABLE_BUILD_TAILNET_PROBE_URL';
export const MALFORMED_PROBE_URL_MESSAGE =
	'PUBLIC_TAILNET_PROBE_URL was malformed when this build was stamped; ' +
	'it must be empty or https://<node>.<tailnet>.ts.net/<path> (value not shown)';

/**
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseStatus(text) {
	const values = new Map();
	for (const line of text.split(/\r?\n/u)) {
		const separator = line.indexOf(' ');
		if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
	}
	return values;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 */
function statusFilePath(env, cwd) {
	return resolve(env.JS_BINARY__EXECROOT ?? cwd, /** @type {string} */ (env.BAZEL_STABLE_STATUS_FILE));
}

/**
 * Build metadata for the stamped Vite build. Throws when the status file is
 * absent, when any key is missing, or when the probe URL was stamped invalid.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {{ basePath: string, commitSha: string, tailnetProbeUrl: string }}
 */
export function readBuildMetadata(env = process.env, cwd = process.cwd()) {
	if (!env.BAZEL_STABLE_STATUS_FILE) {
		throw new Error('BAZEL_STABLE_STATUS_FILE is required; //:build and //:analyze must be stamped');
	}
	const declaredStatusPath = statusFilePath(env, cwd);
	const values = parseStatus(readFileSync(declaredStatusPath, 'utf8'));
	const encodedBasePath = values.get('STABLE_BUILD_BASE_PATH');
	const commitSha = values.get('STABLE_BUILD_COMMIT_SHA');
	const encodedTailnetProbeUrl = values.get(TAILNET_PROBE_KEY);
	if (encodedBasePath === undefined || !commitSha || !encodedTailnetProbeUrl) {
		throw new Error(`build metadata keys are missing from ${declaredStatusPath}`);
	}
	if (encodedTailnetProbeUrl === INVALID_MARKER) throw new Error(MALFORMED_PROBE_URL_MESSAGE);
	return {
		basePath: encodedBasePath === EMPTY_MARKER ? '' : encodedBasePath,
		commitSha,
		tailnetProbeUrl: encodedTailnetProbeUrl === EMPTY_MARKER ? '' : encodedTailnetProbeUrl,
	};
}

/**
 * The tailnet probe URL the leak scan should allow, and where it came from.
 * Inside Bazel (a stable status file is declared) the stamp is the only source
 * and an ambient PUBLIC_TAILNET_PROBE_URL is ignored; a missing key means no
 * allowance. Outside Bazel (a direct `just leak-scan`) the caller's variable is
 * read. The value is returned raw: tailnetProbeHost() in scripts/lib/leak-scan.mjs
 * validates it, and rejects the invalid marker.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {{ url: string, source: 'stamp' | 'environment' }}
 */
export function readTailnetProbeUrl(env = process.env, cwd = process.cwd()) {
	if (!env.BAZEL_STABLE_STATUS_FILE) {
		return { url: env.PUBLIC_TAILNET_PROBE_URL ?? '', source: 'environment' };
	}
	const values = parseStatus(readFileSync(statusFilePath(env, cwd), 'utf8'));
	return { url: values.get(TAILNET_PROBE_KEY) ?? '', source: 'stamp' };
}
