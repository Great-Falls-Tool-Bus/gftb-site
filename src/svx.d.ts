// Ambient module shape for mdsvex-compiled `.svx` content. Needed because
// src/lib/generated/log-manifest.ts (B1 fix, PR #33 review) imports a
// specific `.svx` file per PUBLISHED log entry via a literal
// `import('...svx')` rather than `import.meta.glob`, so a real module
// declaration is required for that import to typecheck — the old code only
// ever went through `import.meta.glob<T>(...)`'s generic, which never needed
// this declaration.
declare module '*.svx' {
	import type { Component } from 'svelte';

	const component: Component;
	export default component;
	export const metadata: Record<string, unknown>;
}
