import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		// `build`'s own script body calls `npm run prepack` internally; that only resolves
		// because `bun run` transparently shims nested npm/npx/yarn/pnpm calls onto Bun.
		// Spawning `npm` directly here (as the scaffold default did) bypasses that shim and
		// fails outright wherever a real npm binary isn't installed, which this repo's
		// tooling never requires anywhere else.
		command: 'bun run build && bun run preview',
		port: 4173
	},
	testDir: 'e2e'
});
