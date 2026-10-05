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

	// Build-time flag injected by vite.config.ts from PUBLIC_SUBSCRIBE_CAPTURE.
	// Absent outside a Vite build; src/lib/subscribe-capture-flag.ts guards it
	// and resolves to off.
	const __SUBSCRIBE_CAPTURE__: boolean | undefined;

	// Build-time tailnet probe URL from PUBLIC_TAILNET_PROBE_URL, empty by
	// default; its origin's /v1/surface is an extra manifest source. Absent
	// outside a Vite build; src/lib/gated/manifest.ts guards it and resolves to
	// empty.
	const __TAILNET_PROBE_URL__: string | undefined;

	// Build-time flag injected by vite.config.ts from PUBLIC_MEMBERSHIP_FIXTURE.
	// True only in a dev or reviewer build, which may then serve the fixture
	// manifest for ?flags=membership. Absent outside a Vite build.
	const __MEMBERSHIP_FIXTURE__: boolean | undefined;
}

export {};
