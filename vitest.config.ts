import { defineConfig } from 'vitest/config';

// `#lib/*` resolves through package.json `imports` (SvelteKit 3 replaced the
// generated `$lib` alias with Node subpath imports), so the unit suite needs
// no alias of its own.
export default defineConfig({
	test: {
		include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts', 'scripts/**/*.test.mts'],
		environment: 'node',
		globals: true,
		passWithNoTests: false,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				lines: 50,
				functions: 50,
				branches: 50,
				statements: 50,
			},
			include: ['src/lib/contact-form.ts', 'src/lib/public-log-schema.ts'],
			exclude: ['**/*.test.ts', '**/*.test.mts', '**/*.test.svelte.ts'],
		},
	},
});
