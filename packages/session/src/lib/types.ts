import type { RequestEvent } from '@sveltejs/kit';
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
 * Structurally equivalent to @sveltejs/kit's `Handle` type. Defined locally rather than
 * imported because its export path moved from `@sveltejs/kit` (v2) to `@sveltejs/kit/hooks`
 * (v3) with no compatibility re-export either direction, so no single static import can
 * satisfy both peer ranges we support.
 */
type Handle = (input: {
	event: RequestEvent;
	resolve: (event: RequestEvent, opts?: any) => MaybePromise<Response>;
}) => MaybePromise<Response>;

/**
 * Internal middleware handle.
 */
type InternalMiddlewareHandle = (
	input: {
		event: RequestEvent;
		resolve: (event: RequestEvent, opts?: any) => MaybePromise<Response>;
	},
	options: InternalSessionConfig
) => MaybePromise<Response>;

export { type SessionConfig, type Handle, type InternalMiddlewareHandle, type InternalSessionConfig };
