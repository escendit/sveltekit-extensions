import {sequence} from '@sveltejs/kit/hooks';
import {type Handle} from '@sveltejs/kit';
import {OidcMiddleware} from "$lib/middleware.js";
import * as process from "node:process";

// IMPORTANT: This is example/demo configuration. In production:
// - Use environment variables for secrets
// - Configure proper OIDC issuer URL
// - Use secure client credentials
export const handle: Handle = sequence(OidcMiddleware({
    expireIn: process.env.KEYCLOAK_EXPIRE_IN ?? 300,
    issuer: process.env.KEYCLOAK_ISSUER,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
}));
