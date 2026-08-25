import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// svelte.config.js does not just go unread under SvelteKit v3 - its mere presence on disk
// makes the Vite plugin throw ("svelte.config.js is no longer used"), so it's deleted
// entirely rather than kept around for older v2. All config lives here instead, which v2
// has supported inline since 2.62.0 (the peerDependencies floor below). The `$lib` alias
// is also no longer built in under v3 by default, so it's reinstated explicitly (deprecated
// but functional) rather than migrating to `#lib`, which the currently-used
// @sveltejs/package doesn't rewrite to relative paths in dist, breaking published consumers.
export default defineConfig({
	plugins: [
		sveltekit({
			preprocess: vitePreprocess(),
			adapter: adapter(),
			alias: { $lib: 'src/lib' }
		}),
		devtoolsJson()
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
