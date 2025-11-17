# @escendit/sveltekit-auth-keycloak

Keycloak/OpenID Connect authentication middleware for SvelteKit. It composes with `@escendit/sveltekit-session` to manage a secure session and performs the OIDC Authorization Code flow with PKCE using `arctic` under the hood.

Works with SvelteKit 2 and Svelte 5.

## Features

- Drop-in `OidcMiddleware` for `hooks.server.ts` (composes with session middleware)
- Built on `@escendit/sveltekit-session` for secure, pluggable session storage
- OIDC Authorization Code + PKCE with Keycloak via `arctic`
- Configurable endpoints and pages for sign-in and sign-out
- Optional automatic sign-in challenge for unauthenticated users
- Session identity populated with tokens and claims after successful login

## Installation

```sh
npm i @escendit/sveltekit-auth-keycloak @escendit/sveltekit-session
# or
pnpm add @escendit/sveltekit-auth-keycloak @escendit/sveltekit-session
# or
bun add @escendit/sveltekit-auth-keycloak @escendit/sveltekit-session
```

Peer/runtime expectations:
- `svelte@^5`
- `@sveltejs/kit@^2` (your app)

## Quick start

Add the middleware to your `src/hooks.server.ts`:

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { OidcMiddleware } from '@escendit/sveltekit-auth-keycloak';

export const handle: Handle = sequence(
  OidcMiddleware({
    issuer: process.env.KEYCLOAK_ISSUER!, // e.g. https://keycloak.example.com/realms/myrealm
    clientId: process.env.KEYCLOAK_CLIENT_ID!,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    // Optional: automatically redirect unauthenticated users to sign-in
    challenge: { signin: false }
  })
);
```

Provide a sign-in link somewhere in your app (defaults shown below):

```svelte
<!-- +page.svelte or a layout -->
<a href="/.oidc/signin?redirect_uri=/">Sign in with Keycloak</a>
```

After a successful login, the session identity is stored and available via `event.locals.session.identity`.

## How it works

- The middleware composes with `@escendit/sveltekit-session` to issue a secure session cookie and provide `event.locals.session`.
- When a user hits `/.oidc/signin`, we generate a PKCE challenge, store it in the session store, and redirect to Keycloak.
- Keycloak redirects back to `/.oidc/signin/callback` with the `code`. We validate it with `arctic`, decode tokens with `jose`, and write an `identity` payload into the session store.
- If `challenge.signin` is enabled and the user is unauthenticated, we redirect them to the sign-in endpoint automatically.

After login, `event.locals.session.identity` contains:
- `authenticated: boolean`
- Token metadata: `accessTokenRaw`, `refreshTokenRaw`, `idTokenRaw`, `tokenType`, `scopes`, `sessionState`
- Expirations: `accessTokenExpiresAt`, `accessTokenExpiresInSeconds`
- Decoded tokens: `accessToken`, `refreshToken`, `idToken` (decoded with `jose`)

## Configuration

`OidcMiddleware(config?: OidcConfig)` where `OidcConfig` extends the session config from `@escendit/sveltekit-session`.

Defaults (from the package):

```ts
const defaults = {
  cookie: 'session.id',
  expireIn: 86400,
  size: 128,
  issuer: 'https://invalid.keycloak.org/realms/master',
  clientId: 'invalid-client',
  clientSecret: 'invalid-secret',
  challenge: { signin: false },
  signin: {
    page: '/account/signin',
    endpoint: '/.oidc/signin',
    callback: '/.oidc/signin/callback'
  },
  signout: {
    page: '/account/signout',
    endpoint: '/.oidc/signout',
    callback: '/.oidc/signout/callback'
  }
} satisfies OidcConfig;
```

Important options:
- `issuer`: Your Keycloak OIDC issuer URL, e.g. `https://keycloak.example.com/realms/myrealm`
- `clientId`, `clientSecret`: Credentials for your Keycloak client
- `challenge.signin`: If `true`, unauthenticated requests are redirected to the sign-in endpoint
- `signin.*` and `signout.*`: Paths for the pages/endpoints used during the flow
- Session options from `@escendit/sveltekit-session`: `cookie`, `expireIn`, `size`, `sessionStore`, `sessionHasher`, `sessionGenerator`

## Accessing identity in load/functions

```ts
// +page.server.ts or a server route
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // locals.session.identity is set after successful sign-in
  return {
    user: locals.session?.identity?.idToken?.preferred_username,
    accessToken: locals.session?.identity?.accessTokenRaw
  };
};
```

## Protecting routes

There are two common approaches:

- Enable automatic challenge:
  - Set `challenge: { signin: true }` in the middleware config. Unauthenticated users get redirected to `signin.endpoint`.

- Manual guard in `load`/endpoints:
  ```ts
  if (!locals.session?.identity?.authenticated) {
    throw redirect(303, `/.oidc/signin?redirect_uri=${encodeURIComponent(url.pathname)}`);
  }
  ```

## Environment variables

Common setup (example in `.env`):

```env
KEYCLOAK_ISSUER=https://keycloak.example.com/realms/myrealm
KEYCLOAK_CLIENT_ID=web-app
KEYCLOAK_CLIENT_SECRET=super-secret
# Optional session tuning
KEYCLOAK_EXPIRE_IN=86400
```

## Notes on sign-out

Sign-out route placeholders are present in the middleware (`signout.page`, `signout.endpoint`, `signout.callback`). The exact logout behavior can vary per Keycloak setup (front-channel/back-channel). You can implement a simple sign-out by clearing the session identity and redirecting to your homepage, or integrate with Keycloak’s end-session endpoint if required.

## Troubleshooting

- Got `invalid_challenge` or `invalid_callback`? Ensure the callback URL configured in Keycloak matches `signin.callback` and that you pass the `challenge` query parameter back (handled automatically by the middleware).
- `issuer mismatched` errors: Verify `KEYCLOAK_ISSUER` matches the realm’s issuer exactly.
- Cookies not set locally: Use `http://localhost` and ensure you’re not mixing `http` and `https`. Also check the session cookie name and domain.

## Related

- Session middleware: `@escendit/sveltekit-session`
- OIDC client: `arctic`
- JWT tools: `jose`

## License

Licensed under the Apache License, Version 2.0. See the `LICENSE` file for the full text.

Copyright (c) 2025 Escendit.
