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
	// so consumers must typeof-guard. The Bazel build adapter derives the 7-char
	// public identity from the projected source marker; dev/test renders without
	// that adapter have no provenance.
	const __COMMIT_SHORT__: string | undefined;
}

export {};
