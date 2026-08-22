// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Build-time constant injected by vite.config.ts's `define` block. Absent
	// outside a Vite build (vitest evaluates modules without the define step),
	// so consumers must typeof-guard. Carries the 7-char stamped commit, or
	// the literal 'unknown' on builds with no explicitly supplied identity
	// (see scripts/bazel/workspace-status.sh).
	const __COMMIT_SHORT__: string | undefined;
}

export {};
