import type { InternalSessionConfig, SessionConfig } from './types.js';
import { InMemorySessionStore } from '$lib/InMemorySessionStore.js';
import { DefaultSessionGenerator } from '$lib/DefaultSessionGenerator.js';
import { DefaultSessionHasher } from '$lib/DefaultSessionHasher.js';

/**
 * Default configuration
 */
const Defaults: InternalSessionConfig = {
	cookie: "session.id",
	expireIn: 86400,
    size: 128,
    sessionStore: new InMemorySessionStore(),
    sessionHasher: new DefaultSessionHasher(),
    sessionGenerator: new DefaultSessionGenerator(),
};

export {
	type SessionConfig,
    type InternalSessionConfig,
	Defaults,
}
