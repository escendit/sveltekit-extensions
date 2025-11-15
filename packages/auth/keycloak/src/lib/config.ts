import type {InternalOidcConfig, InternalMiddlewareHandle} from "$lib/types.ts";
import {InMemorySessionStore, DefaultSessionHasher, DefaultSessionGenerator} from "@escendit/sveltekit-session";

const Defaults: InternalOidcConfig = {
    cookie: "session.id",
    expireIn: 86400,
    size: 128,
    sessionStore: new InMemorySessionStore(),
    sessionHasher: new DefaultSessionHasher(),
    sessionGenerator: new DefaultSessionGenerator(),
    issuer: "https://invalid.keycloak.org/realms/master",
    challenge: {
        signin: false,
    },
    signin: {
        page: "/account/signin",
        endpoint: "/.oidc/signin",
        callback: "/.oidc/signin/callback",
    },
    signout: {
        page: "/account/signout",
        endpoint: "/.oidc/signout",
        callback: "/.oidc/signout/callback",
    },
    clientId: "invalid-client",
    clientSecret: "invalid-secret",
};

export {
    type InternalOidcConfig,
    type InternalMiddlewareHandle,
    Defaults,
}