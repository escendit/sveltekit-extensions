import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// svelte.config.js is no longer read at all under SvelteKit v3 (config now lives here);
// this mirrors the same settings so the package works under both v2 and v3.
export default defineConfig({
	plugins: [
		// @ts-expect-error - the currently-resolved @sveltejs/kit (v2) types sveltekit() as
		// taking no arguments; SvelteKit v3 requires this argument since svelte.config.js is
		// no longer read at all. Remove this suppression once v3 is the resolved dev version.
		sveltekit({
			preprocess: vitePreprocess(),
			kit: {
				adapter: adapter()
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					environment: 'browser',
					browser: {
						enabled: true,
						provider: 'playwright',
						instances: [{ browser: 'chromium' }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-client.ts']
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
