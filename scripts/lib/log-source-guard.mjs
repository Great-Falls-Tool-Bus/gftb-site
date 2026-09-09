/** Public-source checks shared with the existing checked-in log contract. */
/** @type {Array<[string, RegExp]>} */
export const forbiddenPublicPatterns = [
	['email address', /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/iu],
	['cluster-local hostname', /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:svc|cluster\.local)\b/iu],
	['RFC1918 or loopback address', /\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}|127(?:\.\d{1,3}){3})\b/u],
	['localhost', /\blocalhost(?::\d{1,5})?\b/iu],
	['cache or executor endpoint', /\b(?:grpc|grpcs):\/\/|https?:\/\/[^\s)'"<>]*(?:bazel-cache|remote-cache|reapi|executor)[^\s)'"<>]*/iu],
];

/** @param {string} text */
export function assertPublicLogText(text) {
	if (/\b(?:Linear|TIN-\d+|pull request|PR\s*#?\d+|commit SHA|github\.com\/)\b/iu.test(text)) {
		throw new Error('Public log source refused.');
	}
	for (const [, pattern] of forbiddenPublicPatterns) {
		if (pattern.test(text)) throw new Error('Public log source refused.');
	}
}
