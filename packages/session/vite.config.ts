import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// svelte.config.js is no longer read at all under SvelteKit v3 (config now lives here);
// this mirrors the same settings so the package works under both v2 and v3. The `$lib`
// alias is also no longer built in under v3 (replaced by `#lib`, which the currently-used
// @sveltejs/package@2.5.4 doesn't rewrite to relative paths in dist, breaking published
// consumers), so it's reinstated explicitly via kit.alias rather than migrating to `#lib`.
export default defineConfig({
	plugins: [
		// @ts-ignore - the currently-resolved @sveltejs/kit (v2) types sveltekit() as taking
		// no arguments; SvelteKit v3 requires this argument since svelte.config.js is no
		// longer read at all. @ts-ignore (not @ts-expect-error) so this doesn't itself become
		// an error once v3 is the resolved dev version and the argument becomes expected.
		sveltekit({
			preprocess: vitePreprocess(),
			kit: {
				adapter: adapter(),
				alias: { $lib: 'src/lib' }
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
