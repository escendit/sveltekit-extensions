import {sequence} from '@sveltejs/kit/hooks';
import {type Handle} from '@sveltejs/kit';
import {OidcMiddleware} from "$lib/middleware.ts";

export const handle: Handle = sequence(OidcMiddleware({
    expireIn: 300,
    issuer: 'http://localhost:8080/realms/master',
    clientId: 'sveltekit',
    clientSecret: 'secret',
}));
