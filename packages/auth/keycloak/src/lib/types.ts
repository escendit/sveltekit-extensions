import {type ISessionStore} from "@escendit/sveltekit-session";
import {type ISessionHasher} from "@escendit/sveltekit-session";
import {type ISessionGenerator} from "@escendit/sveltekit-session";
import type {SessionConfig} from "@escendit/sveltekit-session";
import type {RequestEvent} from "@sveltejs/kit";
import type {Configuration} from "openid-client";
import type {RemoteJWKSet} from "jose";

/**
 * Similar to @sveltejs/kit's `Handle` type, but intentionally widens `resolve`'s options
 * parameter to `any` instead of `ResolveOptions`. Defined locally rather than imported
 * because its export path moved from `@sveltejs/kit` (v2) to `@sveltejs/kit/hooks` (v3)
 * with no compatibility re-export either direction, so no single static import can satisfy
 * both peer ranges we support.
 */
type Handle = (input: {
    event: RequestEvent;
    resolve: (event: RequestEvent, opts?: any) => MaybePromise<Response>;
}) => MaybePromise<Response>;

type Middleware = (config?: OidcConfig) => Handle;
/**
 * Public Session configuration.
 */
type OidcConfig = SessionConfig & {
    challenge?: {
        signin?: boolean;
    };
    signin?: {
        page?: string;
        endpoint?: string;
        callback?: string;
    };
    signout?: {
        page?: string;
        endpoint?: string;
        callback?: string;
    };
    session?: {
        endpoint?: string;
    };
    backchannelLogout?: {
        endpoint?: string;
    };
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
};

/**
 * Internal Session configuration.
 */
type InternalSessionConfig = {
    cookie: {
        name: string;
        secure: boolean;
    },
    expireIn: number;
    size: number;
    sessionStore: ISessionStore;
    sessionHasher: ISessionHasher;
    sessionGenerator: ISessionGenerator;
};

type InternalOidcConfig = InternalSessionConfig & {
    challenge: {
        signin: boolean;
    };
    signin: {
        page: string;
        endpoint: string;
        callback: string;
    };
    signout: {
        page: string;
        endpoint: string;
        callback: string;
    };
    session: {
        endpoint: string;
    };
    backchannelLogout: {
        endpoint: string;
    };
    issuer: string;
    clientId: string;
    clientSecret: string;
    /**
     * Discovered openid-client Configuration, resolved once when the middleware is
     * constructed and reused for every request rather than rediscovering per-request.
     */
    oidcConfiguration: Promise<Configuration>;
    /**
     * Resolver for the OP's signing keys (from the discovered jwks_uri), used to verify
     * Back-Channel Logout Token signatures. Derived from oidcConfiguration and cached the
     * same way, once per middleware instance - RemoteJWKSet itself also has its own
     * internal fetch cache/cooldown, which recreating it per-request would throw away.
     */
    remoteJWKSet: Promise<RemoteJWKSet>;
};

type MaybePromise<T> = T | Promise<T>;

/**
 * Internal middleware handle.
 */
type InternalMiddlewareHandle = (
    input: {
        event: RequestEvent;
        resolve: (event: RequestEvent, opts?: any) => MaybePromise<Response>;
    },
    options: InternalOidcConfig
) => MaybePromise<Response>;

export type {
    OidcConfig,
    Middleware,
    Handle,
    InternalMiddlewareHandle,
    InternalSessionConfig,
    InternalOidcConfig,
};
