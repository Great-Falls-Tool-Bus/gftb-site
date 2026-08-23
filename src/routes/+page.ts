import { publicLogs } from '$lib/public-logs';
import type { PageLoad } from './$types';

// Resolves the latest published log entry's body component here, in the
// universal load (re-run on the client during hydration exactly like the
// server run during prerender), rather than reading a pre-resolved
// `.component` field off publicLogs — the component is only imported per
// published slug, lazily (B1 fix; see src/lib/public-logs.ts).
export const load: PageLoad = async () => {
	const latest = publicLogs[0];
	const LatestLog = latest ? (await latest.loadComponent()).default : null;
	return { LatestLog };
};
