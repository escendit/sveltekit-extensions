// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type {InternalOidcConfig} from "$lib/types.ts";

declare global {
	namespace App {
		// interface Error {}
        interface Locals {
            store: ISessionStore;
            hasher: ISessionHasher;
            generator: ISessionGenerator;
            config: InternalOidcConfig;
            sessionId: string;
            session: any;
        }
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
