import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
		},
	},
	test: {
		include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts', 'scripts/**/*.test.mts'],
		environment: 'node',
		globals: true,
		// Allow vacuous green on empty test set (M0.4 → M0.6 ramp).
		// Set to false in M3 once content + smoke tests land.
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			thresholds: {
				lines: 50,
				functions: 50,
				branches: 50,
				statements: 50,
			},
			// Unit coverage owns pure library logic. Browser actions/runes, Svelte
			// routes, and operator CLIs are exercised by E2E/contract lanes instead.
			include: [
				'src/lib/projection/static-snapshot.ts',
				'src/lib/responsive-image.ts',
				'src/lib/theme/contrast-check.ts',
				'src/lib/util/**/*.ts',
			],
			exclude: ['**/*.test.ts', '**/*.test.mts', '**/*.test.svelte.ts'],
		},
	},
});
