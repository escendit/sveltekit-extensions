# @escendit/sveltekit-auth-keycloak

Keycloak/OpenID Connect authentication middleware for SvelteKit. It composes with `@escendit/sveltekit-session` to manage a secure session and performs the OIDC Authorization Code flow with PKCE using `openid-client` under the hood.

Works with SvelteKit 2 and Svelte 5.

## Features

- Drop-in `OidcMiddleware` for `hooks.server.ts` (composes with session middleware)
- Built on `@escendit/sveltekit-session` for secure, pluggable session storage
- OIDC Authorization Code + PKCE with Keycloak via `openid-client`
- Configurable endpoints and pages for sign-in and sign-out
- Optional automatic sign-in challenge for unauthenticated users
- Session identity populated with tokens and claims after successful login
- Transparent access-token refresh on expiry, RP-Initiated Logout on sign-out
- Client-side OpenID Connect Session Management 1.0 (drop-in `<SessionMonitor />` component, or the lower-level `createSessionMonitor`) to react when the user's session changes at Keycloak outside this app
- Server-side OpenID Connect Back-Channel Logout 1.0 so sessions get cleared even with no browser tab open to notice

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
- Keycloak redirects back to `/.oidc/signin/callback` with the `code`. We validate it with `openid-client`, decode tokens with `jose`, and write an `identity` payload into the session store.
- If `challenge.signin` is enabled and the user is unauthenticated, we redirect them to the sign-in endpoint automatically.
- On each request from an already-authenticated user, if the stored access token has expired, we transparently refresh it with Keycloak using the stored refresh token before continuing - no redirect, the request just proceeds with fresh tokens. If the refresh token is missing, expired, or revoked, the session is cleared and the request falls through to the normal unauthenticated handling (including `challenge.signin`, if enabled).

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

## Signing out

Link users to `signout.endpoint` (default `/.oidc/signout`, optionally with a `redirect_uri` query param, same as sign-in) to sign out:

```svelte
<a href="/.oidc/signout?redirect_uri=/">Sign out</a>
```

Visiting it clears the local session immediately, then performs RP-Initiated Logout: it redirects the user through Keycloak's `end_session_endpoint` so their SSO session ends there too, not just in this app. Keycloak redirects back to `signout.callback`, which then sends the user on to `redirect_uri` (or the app origin if none was given). If the issuer doesn't expose an `end_session_endpoint`, the local session is still cleared and the user is redirected directly, without the round trip through Keycloak.

## Reacting to a session change at Keycloak (OpenID Connect Session Management 1.0)

Sign-out and token refresh only react to *this app's own* requests. If the user signs out of Keycloak directly (another app in the SSO realm, a Keycloak admin action, another tab), this app has no way to know until its own session/access token happens to expire. [OpenID Connect Session Management 1.0](https://openid.net/specs/openid-connect-session-1_0.html) closes that gap: a hidden iframe polls Keycloak's `check_session_iframe` on an interval and tells you as soon as the session state changes, so you can react (typically by signing out locally) without waiting for the next page load.

This only works when the app and Keycloak are same-site (e.g. `app.example.com` and `auth.example.com`, both under `example.com`) - genuinely cross-site setups are subject to third-party cookie blocking that breaks the iframe's ability to see Keycloak's session cookie.

The easiest way to wire it up is dropping `<SessionMonitor />` into a root `+layout.svelte`:

```svelte
<script>
  import { SessionMonitor } from '@escendit/sveltekit-auth-keycloak';
</script>

<SessionMonitor />
```

By default this fetches `session.endpoint` (`/.oidc/session`) on mount, does nothing if unauthenticated or the OP doesn't support Session Management, and otherwise starts polling and redirects to `/.oidc/signout` when Keycloak reports the session changed. All of that is overridable via props:

```svelte
<SessionMonitor
  endpoint="/.oidc/session"
  intervalMs={3000}
  onchanged={() => {
    // Custom reaction instead of the default sign-out redirect - e.g. a silent
    // prompt=none re-authentication, or just prompting the user before redirecting.
  }}
  onerror={(data) => {
    // Keycloak's iframe reported an error (non-retryable - polling has already stopped).
  }}
/>
```

### Lower-level: `createSessionMonitor`

`SessionMonitor` is a thin wrapper around `createSessionMonitor`, which is framework-agnostic (no SvelteKit dependency) and available directly if you need more control than the component's props give you - a custom fetch/caching strategy for the session data, or usage outside Svelte entirely:

```ts
import { createSessionMonitor } from '@escendit/sveltekit-auth-keycloak';

const session = await fetch('/.oidc/session').then((r) => r.json());

if (session.authenticated && session.sessionManagementSupported) {
  const monitor = createSessionMonitor({
    checkSessionIframe: session.checkSessionIframe,
    clientId: session.clientId,
    sessionState: session.sessionState,
    onChanged: () => {
      window.location.href = '/.oidc/signout';
    }
  });

  monitor.start();
  // later: monitor.stop();
}
```

`GET session.endpoint` (default `/.oidc/session`) returns:
- `{ "authenticated": false }` if there's no signed-in session.
- `{ "authenticated": true, "sessionManagementSupported": false }` if signed in but the OP didn't advertise a `check_session_iframe` in its discovery document.
- `{ "authenticated": true, "sessionManagementSupported": true, "clientId": "...", "sessionState": "...", "checkSessionIframe": "..." }` otherwise - everything `createSessionMonitor` needs.

`createSessionMonitor` takes those four values plus an `onChanged` callback, and optionally `onError` (called once, non-retryably, if Keycloak's iframe reports `"error"`) and `intervalMs` (default `3000`).

## Reacting to a session change when no browser tab is open (OpenID Connect Back-Channel Logout 1.0)

Session Management only works while a tab is open polling `check_session_iframe`. [Back-Channel Logout](https://openid.net/specs/openid-connect-backchannel-1_0.html) closes the remaining gap: Keycloak POSTs a signed Logout Token directly to this app, server to server, whenever a session ends - no browser involved at all. Treat the two as complementary, not either/or: Session Management gives you fast, in-tab reactivity; Back-Channel Logout guarantees the session gets cleared server-side even if nobody's tab is open to notice.

Setup: register `backchannelLogout.endpoint` (default `/.oidc/backchannel-logout`) as the client's **Backchannel Logout URL** in the Keycloak admin console. No app code beyond that - `OidcMiddleware` handles verification and session clearing automatically once the sign-in flow has run at least once (the `sid` index a Logout Token gets matched against is written at sign-in/refresh).

What gets validated on an incoming Logout Token, beyond the general "is this a well-formed OIDC exchange" checks: signature (against the OP's `jwks_uri`), `iss`/`aud`, freshness (`iat` within the last 5 minutes), no `nonce` claim (a Logout Token that has one is suspect - that's an ID Token shape, not a Logout Token), the required `backchannel-logout` `events` claim, and at least one of `sub`/`sid`. A token that fails any of these gets a `400`; a validly-signed token that just doesn't match anything Keycloak clears the session for is still a `200` - the RP has nothing to act on, but the token wasn't invalid.

Two things worth knowing about the current scope:
- Session lookup only works when the Logout Token carries a `sid` claim (Keycloak always includes one when Backchannel Logout is enabled for the client). A `sub`-only token can't be mapped to a specific local session without risking clearing the wrong one for a user with multiple concurrent sessions, so it's accepted (`200`) but not acted on.
- This clears the session in *this app's own store*. With a centrally shared store (`RedisSessionStore`), that's authoritative for every instance behind it. With `InMemorySessionStore` across multiple horizontally-scaled instances, only the instance that happened to receive Keycloak's POST is affected - the others keep the session until it naturally expires. It also does **not** push anything to an already-open browser tab by itself (no SSE/WebSocket channel is set up here) - that tab keeps working with its now-server-side-cleared session until its own access token expires or it hits a request that re-checks. Session Management (above) is what closes that particular gap while a tab is open.

## Troubleshooting

- Got `invalid_challenge` or `invalid_callback`? Ensure the callback URL configured in Keycloak matches `signin.callback` exactly (the challenge is correlated via the `state` parameter, which Keycloak round-trips automatically — no manual query parameter is needed).
- `issuer mismatched` errors: Verify `KEYCLOAK_ISSUER` matches the realm’s issuer exactly.
- Cookies not set locally: Use `http://localhost` and ensure you’re not mixing `http` and `https`. Also check the session cookie name and domain.
- Unreachable or misconfigured `issuer`: OIDC discovery runs once when `OidcMiddleware` is constructed and is reused for every request. If it fails (unreachable issuer, DNS failure, etc.) the server itself keeps running rather than crashing. Sign-in and token refresh, which need the discovered configuration, fail per-request. Sign-out degrades gracefully instead: the local session is still cleared, and the user is redirected directly to `redirect_uri` (skipping the Keycloak round trip) rather than the request failing.

## Related

- Session middleware: `@escendit/sveltekit-session`
- OIDC client: `openid-client`
- JWT tools: `jose`

## License

Licensed under the Apache License, Version 2.0. See the `LICENSE` file for the full text.

Copyright (c) 2025 Escendit.
