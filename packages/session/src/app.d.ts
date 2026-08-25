// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { ISessionGenerator, ISessionHasher, ISessionStore } from '$lib';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			store: ISessionStore;
			hasher: ISessionHasher;
			generator: ISessionGenerator;
			sessionId: string;
			session: any;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
