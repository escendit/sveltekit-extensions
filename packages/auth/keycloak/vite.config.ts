import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from 'svelte-adapter-bun';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// svelte.config.js is no longer read at all under SvelteKit v3 (config now lives here);
// this mirrors the same settings so the package works under both v2 and v3. The `$lib`
// alias is also no longer built in by default under v3, so it's reinstated explicitly via
// kit.alias rather than migrating to `#lib` (which the currently-used @sveltejs/package
// doesn't rewrite to relative paths in dist, breaking published consumers - see #63).
export default defineConfig({
	plugins: [
		// @ts-ignore - the currently-resolved @sveltejs/kit (v2) types sveltekit() as taking
		// no arguments; SvelteKit v3 requires this argument since svelte.config.js is no
		// longer read at all. @ts-ignore (not @ts-expect-error) so this doesn't itself become
		// an error once v3 is the resolved dev version.
		sveltekit({
			preprocess: vitePreprocess(),
			kit: {
				adapter: adapter(),
				alias: { $lib: 'src/lib' }
			}
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
