import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';
import type { ISessionStore } from '$lib/ISessionStore.js';
import type { ISessionHasher } from '$lib/ISessionHasher.js';
import type { ISessionGenerator } from '$lib/ISessionGenerator.js';

/**
 * Public Session configuration.
 */
type SessionConfig = {
	cookie?: {
        name?: string;
        secure?: boolean;
    };
	expireIn?: number;
	size?: number;
	sessionStore?: ISessionStore;
	sessionHasher?: ISessionHasher;
	sessionGenerator?: ISessionGenerator;
};

/**
 * Internal Session configuration.
 */
type InternalSessionConfig = {
    cookie: {
        name: string;
        secure: boolean;
    };
	expireIn: number;
	size: number;
	sessionStore: ISessionStore;
	sessionHasher: ISessionHasher;
	sessionGenerator: ISessionGenerator;
};

type MaybePromise<T> = T | Promise<T>;

/**
 * Internal middleware handle.
 */
type InternalMiddlewareHandle = (
	input: {
		event: RequestEvent;
		resolve: (event: RequestEvent, opts?: ResolveOptions) => MaybePromise<Response>;
	},
	options: InternalSessionConfig
) => MaybePromise<Response>;

export { type SessionConfig, type InternalMiddlewareHandle, type InternalSessionConfig };
