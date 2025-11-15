import {type ISessionStore} from "@escendit/sveltekit-session";
import {type ISessionHasher} from "@escendit/sveltekit-session";
import {type ISessionGenerator} from "@escendit/sveltekit-session";
import type {SessionConfig} from "@escendit/sveltekit-session";
import type {RequestEvent, ResolveOptions} from "@sveltejs/kit";

/**
 * Public Session configuration.
 */
type OidcConfig = SessionConfig & {
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
    issuer: string;
    clientId: string;
    clientSecret: string;
};

/**
 * Internal Session configuration.
 */
type InternalSessionConfig = {
    cookie: string;
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
    issuer: string;
    clientId: string;
    clientSecret: string;
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
    options: InternalOidcConfig
) => MaybePromise<Response>;

export type {
    OidcConfig,
    InternalMiddlewareHandle,
    InternalSessionConfig,
    InternalOidcConfig,
};
