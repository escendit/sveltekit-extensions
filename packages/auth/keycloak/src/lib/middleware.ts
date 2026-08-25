import type {Handle, InternalMiddlewareHandle, InternalOidcConfig, Middleware, OidcConfig} from "$lib/types.js";
import type {RequestEvent} from "@sveltejs/kit";
import type {ISessionStore} from "@escendit/sveltekit-session";
import {json} from "@sveltejs/kit";
import {sequence} from "@sveltejs/kit/hooks";
import {SessionMiddleware} from "@escendit/sveltekit-session";
import {Defaults} from "$lib/config.js";
import * as client from "openid-client";
import * as jose from "jose";

// How long an in-flight sign-in/sign-out challenge is kept in the session store before
// it's considered abandoned. Bounds the resource leak from users who start a flow but
// never complete the round trip (closed tab, IdP unreachable, etc.).
const CHALLENGE_TTL_SECONDS = 600;

/**
 * Only accept a `redirect_uri` that resolves to the same origin as the current request.
 * Without this, an attacker-supplied `redirect_uri` (e.g. `?redirect_uri=https://evil.example`)
 * would be stored and later sent back as a post-authentication/post-logout redirect target -
 * an open redirect.
 */
const SanitizeRedirectUri = (event: RequestEvent, candidate: string | null): string => {
    if (candidate !== null) {
        try {
            const resolved = new URL(candidate, event.url.origin);

            if (resolved.origin === event.url.origin) {
                return resolved.toString();
            }
        } catch {
            // fall through to the origin below
        }
    }

    return event.url.origin;
}

/**
 * True if the stored identity's access token has expired. `accessTokenExpiresAt` comes
 * back from JSON.parse as a plain string, not a revived Date, hence the re-parse. A
 * missing expiry (the authorization server didn't return `expires_in`) is treated as
 * "unknown, assume still valid" rather than forcing a refresh on every request.
 */
const IsAccessTokenExpired = (identity: any): boolean => {
    if (!identity.accessTokenExpiresAt) {
        return false;
    }

    return new Date(identity.accessTokenExpiresAt).getTime() <= Date.now();
}

/**
 * Maintains a `sid` (OIDC session id, from the decoded ID token) -> our own session id
 * lookup, so a Back-Channel Logout Token (which only ever carries the OP's `sid`/`sub`,
 * never our session cookie value) can be mapped back to the local session to clear. A
 * no-op when the ID token has no `sid` claim - not every OP includes one, but Keycloak
 * does whenever the client has Back-Channel Logout enabled, which is the only scenario
 * this index exists for. Expires alongside the session it points at.
 */
const IndexBackchannelSid = async (
    store: ISessionStore,
    config: InternalOidcConfig,
    sessionId: string,
    idToken: any,
): Promise<void> => {
    if (typeof idToken?.sid !== "string") {
        return;
    }

    const indexKey = `backchannel:sid:${idToken.sid}`;
    await store.setSingle(indexKey, sessionId);
    await store.expire(indexKey, config.expireIn);
}

/** Cleans up the index entry `IndexBackchannelSid` wrote, given the identity it was written for. */
const DeleteBackchannelSidIndex = async (store: ISessionStore, identity: any): Promise<void> => {
    if (typeof identity?.idToken?.sid === "string") {
        await store.delete(`backchannel:sid:${identity.idToken.sid}`);
    }
}

/**
 * Refresh an expired access token using the stored refresh token, replacing the session's
 * identity with the new tokens. Returns the new identity on success, or null when there's
 * no refresh token to use or the authorization server has genuinely rejected it (expired,
 * revoked, or already consumed) - callers should treat null as "no longer authenticated".
 */
const RefreshIdentity = async (
    config: InternalOidcConfig,
    store: ISessionStore,
    sessionId: string,
    identity: any
): Promise<Record<string, any> | null> => {
    if (!identity.refreshTokenRaw) {
        await store.delete(`session:${sessionId}`);
        await DeleteBackchannelSidIndex(store, identity);
        return null;
    }

    try {
        const configuration = await config.oidcConfiguration;
        const data = await client.refreshTokenGrant(configuration, identity.refreshTokenRaw);

        const accessToken = jose.decodeJwt(data.access_token);
        const refreshToken = data.refresh_token ? jose.decodeJwt(data.refresh_token) : identity.refreshToken ?? null;
        const idToken = data.id_token ? jose.decodeJwt(data.id_token) : identity.idToken ?? null;
        const expiresInSeconds = data.expiresIn();

        const sessionData = {
            authenticated: true,
            validationErrors: identity.validationErrors ?? [],
            accessTokenRaw: data.access_token,
            accessTokenExpiresAt: expiresInSeconds !== undefined ? new Date(Date.now() + expiresInSeconds * 1000) : null,
            accessTokenExpiresInSeconds: expiresInSeconds ?? null,
            // Keycloak may not rotate the refresh token on every refresh - keep the
            // existing one when the server doesn't send a new one.
            refreshTokenRaw: data.refresh_token ?? identity.refreshTokenRaw,
            idTokenRaw: data.id_token ?? identity.idTokenRaw ?? null,
            tokenType: data.token_type,
            scopes: data.scope?.split(' ') ?? identity.scopes ?? [],
            sessionState: identity.sessionState,
            accessToken,
            refreshToken,
            idToken,
        };

        await store.setMultiple(`session:${sessionId}`, [
            "identity",
            JSON.stringify(sessionData),
        ]);
        await IndexBackchannelSid(store, config, sessionId, idToken);

        return sessionData;
    } catch (e) {
        if (e instanceof client.ResponseBodyError) {
            // Concurrent requests can race to refresh the same expired identity. If
            // Keycloak rotates refresh tokens, whichever request loses the race gets
            // rejected here even though the session was, moments ago, successfully
            // refreshed by the winner. Re-read before giving up on the session: if the
            // stored refresh token no longer matches the one we tried, someone else
            // already won the race - use their result instead of logging the user out.
            const [currentIdentityJson] = await store.getMultiple(`session:${sessionId}`, ["identity"]);
            const currentIdentity = currentIdentityJson ? JSON.parse(currentIdentityJson) : null;

            if (currentIdentity && currentIdentity.refreshTokenRaw !== identity.refreshTokenRaw) {
                return currentIdentity;
            }

            // The authorization server genuinely rejected the refresh token (expired,
            // revoked, or already consumed) - the session can't be recovered.
            await store.delete(`session:${sessionId}`);
            await DeleteBackchannelSidIndex(store, identity);
            return null;
        }

        // Transient failure (network, discovery, session-store write, etc.) - don't
        // destroy a possibly-still-valid session over what might be a blip. Propagate so
        // the request fails loudly instead of silently logging the user out.
        throw e;
    }
}

const OidcMiddleware: Middleware = (config?: OidcConfig): Handle => {

    let configuredConfig: InternalOidcConfig = {
        ...Defaults,
        cookie: {
            ...Defaults.cookie,
        },
        challenge: {
            ...Defaults.challenge,
        },
        signin: {
            ...Defaults.signin,
        },
        signout: {
            ...Defaults.signout,
        },
        session: {
            ...Defaults.session,
        },
        backchannelLogout: {
            ...Defaults.backchannelLogout,
        },
    };

    if (config?.cookie !== undefined) {
        if (config.cookie.name !== undefined) {
            configuredConfig.cookie.name = config.cookie.name;
        }

        if (config.cookie.secure !== undefined) {
            configuredConfig.cookie.secure = config.cookie.secure;
        }
    }

    if (config?.expireIn !== undefined) {
        configuredConfig.expireIn = config.expireIn;
    }

    if (config?.size !== undefined) {
        configuredConfig.size = config.size;
    }

    if (config?.sessionStore !== undefined) {
        configuredConfig.sessionStore = config.sessionStore;
    }

    if (config?.sessionGenerator !== undefined) {
        configuredConfig.sessionGenerator = config.sessionGenerator;
    }

    if (config?.sessionHasher !== undefined) {
        configuredConfig.sessionHasher = config.sessionHasher;
    }

    if (config?.challenge !== undefined) {
        if (config.challenge.signin !== undefined) {
            configuredConfig.challenge.signin = config.challenge.signin;
        }
    }

    if (config?.signin !== undefined) {
        if (config.signin.endpoint !== undefined) {
            configuredConfig.signin.endpoint = config.signin.endpoint;
        }

        if (config.signin.page !== undefined) {
            configuredConfig.signin.page = config.signin.page;
        }

        if (config.signin.callback !== undefined) {
            configuredConfig.signin.callback = config.signin.callback;
        }
    }

    if (config?.signout !== undefined) {
        if (config.signout.page !== undefined) {
            configuredConfig.signout.page = config.signout.page;
        }

        if (config.signout.endpoint !== undefined) {
            configuredConfig.signout.endpoint = config.signout.endpoint;
        }

        if (config.signout.callback !== undefined) {
            configuredConfig.signout.callback = config.signout.callback;
        }
    }

    if (config?.session !== undefined) {
        if (config.session.endpoint !== undefined) {
            configuredConfig.session.endpoint = config.session.endpoint;
        }
    }

    if (config?.backchannelLogout !== undefined) {
        if (config.backchannelLogout.endpoint !== undefined) {
            configuredConfig.backchannelLogout.endpoint = config.backchannelLogout.endpoint;
        }
    }

    if (config?.issuer !== undefined) {
        configuredConfig.issuer = config.issuer;
    }

    if (config?.clientId !== undefined) {
        configuredConfig.clientId = config.clientId;
    }

    if (config?.clientSecret !== undefined) {
        configuredConfig.clientSecret = config.clientSecret;
    }

    const errors = ValidateOidcConfiguration(configuredConfig);

    if (errors.length > 0) {
        console.error(errors);
        throw new Error('Invalid oidc config');
    }

    // Discover once per middleware instance and reuse for every request rather than
    // rediscovering (a network round-trip) on each one.
    configuredConfig.oidcConfiguration = client.discovery(
        new URL(configuredConfig.issuer),
        configuredConfig.clientId,
        configuredConfig.clientSecret,
    );

    // Nothing awaits this promise synchronously at construction time, so an unreachable
    // or misconfigured issuer would otherwise reject it with zero attached handlers -
    // Node treats that as an unhandled rejection and crashes the whole process on
    // startup, taking down every route, not just OIDC ones. Attaching a no-op handler
    // here only marks the rejection as "observed" for that purpose; it doesn't consume
    // the value, so every real per-request `await config.oidcConfiguration` below still
    // sees the same rejection and surfaces it as a normal per-request error.
    configuredConfig.oidcConfiguration.catch(() => {});

    // Derived from oidcConfiguration and cached the same way (once per middleware
    // instance, not per-request) - RemoteJWKSet has its own internal fetch cache/cooldown
    // that recreating it on every Back-Channel Logout POST would throw away.
    configuredConfig.remoteJWKSet = configuredConfig.oidcConfiguration.then((configuration) => {
        const jwksUri = configuration.serverMetadata().jwks_uri;

        if (typeof jwksUri !== "string") {
            throw new Error("OP discovery document has no jwks_uri - Back-Channel Logout token signatures cannot be verified");
        }

        return jose.createRemoteJWKSet(new URL(jwksUri));
    });

    // Same unhandled-rejection concern as oidcConfiguration above.
    configuredConfig.remoteJWKSet.catch(() => {});

    const handleOidcMiddleware: Handle = async (request) => {
        return handleOidcMiddlewareInternal(request, configuredConfig);
    };

    const sessionAwareHandle = sequence(SessionMiddleware(configuredConfig), handleOidcMiddleware);

    return async ({event, resolve}) => {
        // The Back-Channel Logout endpoint receives a server-to-server POST straight from
        // Keycloak with no session cookie at all. SessionMiddleware only lets non-GET
        // requests through when an existing cookie already resolves to a session -
        // otherwise it responds 405 before this middleware ever sees the request. Intercept
        // this path ahead of SessionMiddleware entirely and use config.sessionStore
        // directly, since SessionMiddleware never gets a chance to populate
        // event.locals.store for it.
        if (event.url.pathname === configuredConfig.backchannelLogout.endpoint) {
            return handleBackchannelLogoutEndpoint(event, configuredConfig);
        }

        return sessionAwareHandle({event, resolve});
    };
}

const handleOidcMiddlewareInternal: InternalMiddlewareHandle = async (request, config: InternalOidcConfig) => {
    const {event, resolve} = request;
    event.locals.config = config;
    const {sessionId, store} = event.locals;

    if (!sessionId) {
        return resolve(event);
    }

    const [identityJson] = await store.getMultiple(`session:${sessionId}`, ["identity"]);
    const identity = identityJson ? JSON.parse(identityJson) : null;

    // Sign-out and session-check routes must stay reachable regardless of auth state -
    // sign-out for the obvious reason, and the session-check endpoint because the client-
    // side OP Iframe polling loop (OpenID Connect Session Management 1.0) needs to be able
    // to ask "is there still a session, and if so what's its session_state" independent of
    // whether the request itself carries one. Checked before the identity gate below,
    // which is specifically for sign-in routes (no point re-running the login flow for an
    // authenticated user).
    switch (event.url.pathname) {
        case `${config.signout?.endpoint}`:
            return handleSignOutEndpoint(request);
        case `${config.signout?.callback}`:
            return handleSignOutCallback(request);
        case `${config.signout?.page}`:
            return handleSignOutPage(request);
        case `${config.session?.endpoint}`:
            return handleSessionEndpoint(request);
    }

    if (identity) {
        if (IsAccessTokenExpired(identity)) {
            const refreshedIdentity = await RefreshIdentity(config, store, sessionId, identity);

            // SessionMiddleware already populated event.locals.session.identity with the
            // (now stale) pre-refresh snapshot before this handler ran. Overwrite it so
            // downstream load functions/endpoints see the outcome of the refresh instead
            // of the expired tokens or a session that's actually been cleared.
            event.locals.session.identity = refreshedIdentity;

            if (!refreshedIdentity) {
                // Refresh failed (or wasn't possible) and the session was cleared - fall
                // through to the normal unauthenticated handling below.
                return handleOidcMiddlewareInternal(request, config);
            }
        }

        return resolve(event);
    }

    switch (event.url.pathname) {
        case "/favicon.ico":
            // static content we should skip, but this is only an opinion...
            return handleSkip(request);
        case `${config.signin?.page}`:
            return handleSignInPage(request);
        case `${config.signin?.endpoint}`:
            return handleSignInEndpoint(request);
        case `${config.signin?.callback}`:
            return handleSignInCallback(request);
    }

    // Automatic Sign-in
    const automaticChallenge = config.challenge?.signin;

    if (automaticChallenge) {
        return new Response(null, {
            status: 307,
            headers: {
                Location: `${config.signin.endpoint}?redirect_uri=${event.url.toString()}`,
            },
        });
    }

    return resolve(event);
};

const handleSkip: Handle = async ({event, resolve}) => {
    return resolve(event);
}

const handleSignInPage: Handle = async ({event, resolve}) => {
    return resolve(event);
}

const handleSignInEndpoint: Handle = async ({event, resolve}) => {

    // signin process starts here
    // fetch session id
    const {config, store, sessionId} = event.locals;
    const relativeSignInCallback = config.signin?.callback;

    // get current session data if they exist
    const [identityJson, _] = await store.getMultiple(`session:${sessionId}`, ["identity", "created"]);
    const identity = identityJson ? JSON.parse(identityJson) : null;

    if (identity !== null) {
        return resolve(event);
    }

    const parsedRedirectUri = SanitizeRedirectUri(event, event.url.searchParams.get('redirect_uri'));

    // create the challenge
    // The redirect_uri must stay static (no query params) - openid-client derives the
    // redirect_uri it sends to the token endpoint by stripping currentUrl's query params,
    // so a per-request query param here would cause a redirect_uri mismatch at token
    // exchange. `state` doubles as the challenge lookup key instead.
    const originalRedirectUri = parsedRedirectUri;
    const state = client.randomState();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    const scopes = ['openid', 'profile'];
    const redirectUri = `${event.url.origin}${relativeSignInCallback}`;

    const challenge = {
        codeVerifier,
        originalRedirectUri,
        redirectUri,
        scopes,
    }

    // store the challenge
    await store.setSingle(`challenge:signIn:${state}`, JSON.stringify(challenge));
    await store.expire(`challenge:signIn:${state}`, CHALLENGE_TTL_SECONDS);

    // build authorization url
    const configuration = await config.oidcConfiguration;
    const authorizationUri = client.buildAuthorizationUrl(configuration, {
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });

    // redirect here to the keycloak signin page
    return new Response(null, {
        status: 307,
        headers: {
            Location: authorizationUri.toString(),
        }
    });
}

const handleSignInCallback: Handle = async ({event}) => {
    let validationErrors: string[] = [];

    const {config, store, sessionId} = event.locals;
    const issuer = config.issuer;
    const {
        state,
        session_state,
        iss,
    } = Object.fromEntries(event.url.searchParams.entries());

    const challengeJson = state !== undefined ? await store.getSingle(`challenge:signIn:${state}`) : null;

    if (challengeJson === null) {
        return json({
                "error": "invalid_challenge",
            },
            {
                status: 400,
            });
    }

    const challenge = JSON.parse(challengeJson);

    if (iss !== undefined && iss !== issuer) {
        validationErrors.push("Issuer mismatched");
    }

    if (validationErrors.length > 0) {
        await store.delete(`challenge:signIn:${state}`);
        return json(
            {
                error: "invalid_callback",
            },
            {
                status: 400,
            },
        );
    }

    try {
        const configuration = await config.oidcConfiguration;
        const data = await client.authorizationCodeGrant(configuration, event.url, {
            expectedState: state,
            pkceCodeVerifier: challenge.codeVerifier,
        });

        const accessToken = jose.decodeJwt(data.access_token);
        const refreshToken = data.refresh_token ? jose.decodeJwt(data.refresh_token) : null;
        const idToken = data.id_token ? jose.decodeJwt(data.id_token) : null;
        const expiresInSeconds = data.expiresIn();

        const sessionData = {
            authenticated: true,
            validationErrors,
            accessTokenRaw: data.access_token,
            accessTokenExpiresAt: expiresInSeconds !== undefined ? new Date(Date.now() + expiresInSeconds * 1000) : null,
            accessTokenExpiresInSeconds: expiresInSeconds ?? null,
            refreshTokenRaw: data.refresh_token ?? null,
            idTokenRaw: data.id_token ?? null,
            tokenType: data.token_type,
            scopes: data.scope?.split(' ') ?? [],
            sessionState: session_state,
            // expand data
            accessToken: accessToken,
            refreshToken: refreshToken,
            idToken: idToken,
        };

        const identityJson = JSON.stringify(sessionData);

        // delete challenge data, after a successful challenge
        await store.delete(`challenge:signIn:${state}`);

        // mark the user for a session.
        await store.setMultiple(`session:${sessionId}`, [
            "identity",
            identityJson,
        ])
        await IndexBackchannelSid(store, config, sessionId, idToken);

        // redirect back to a starting point
        return new Response(null, {
            status: 307,
            headers: {
                Location: challenge.originalRedirectUri,
            },
        });
    }
    catch (e) {
        if (e instanceof client.ResponseBodyError) {
        }
        if (e instanceof client.AuthorizationResponseError) {
        }

        await store.delete(`challenge:signIn:${state}`);
        await store.setMultiple(`session:${sessionId}`, [
            "identity",
            JSON.stringify(null),
        ]);
    }

    return new Response(null, {
        status: 400,
    });
}

const handleSignOutPage: Handle = async ({event, resolve}) => {
    return resolve(event);
}

const handleSignOutEndpoint: Handle = async ({event}) => {
    const {config, store, sessionId} = event.locals;

    // Read the identity before clearing it so we can pass id_token_hint - this lets
    // Keycloak end the correct SSO session without prompting the user to pick one.
    const [identityJson] = await store.getMultiple(`session:${sessionId}`, ["identity"]);
    const identity = identityJson ? JSON.parse(identityJson) : null;

    // Clear the local session immediately. The RP-initiated logout redirect below is
    // best-effort - even if it never completes (user closes the tab, IdP is down), the
    // local app session must already be gone.
    await store.delete(`session:${sessionId}`);
    await DeleteBackchannelSidIndex(store, identity);

    const parsedRedirectUri = SanitizeRedirectUri(event, event.url.searchParams.get('redirect_uri'));

    const state = client.randomState();
    const postLogoutRedirectUri = `${event.url.origin}${config.signout.callback}`;

    await store.setSingle(`challenge:signOut:${state}`, JSON.stringify({
        originalRedirectUri: parsedRedirectUri,
    }));
    await store.expire(`challenge:signOut:${state}`, CHALLENGE_TTL_SECONDS);

    try {
        const configuration = await config.oidcConfiguration;
        const endSessionParams: Record<string, string> = {
            post_logout_redirect_uri: postLogoutRedirectUri,
            state,
        };

        if (identity?.idTokenRaw) {
            endSessionParams.id_token_hint = identity.idTokenRaw;
        }

        const endSessionUri = client.buildEndSessionUrl(configuration, endSessionParams);

        return new Response(null, {
            status: 307,
            headers: {
                Location: endSessionUri.toString(),
            },
        });
    } catch (e) {
        // RP-initiated logout isn't available (e.g. no end_session_endpoint discovered).
        // The local session is already cleared above, so just send the user on their way.
        await store.delete(`challenge:signOut:${state}`);

        return new Response(null, {
            status: 307,
            headers: {
                Location: parsedRedirectUri,
            },
        });
    }
}

/**
 * Feeds the client-side OpenID Connect Session Management 1.0 iframe-polling loop
 * (`createSessionMonitor` in `$lib/client`) the pieces it needs to talk to the OP's
 * check_session_iframe directly: the discovered iframe URL, the client_id, and the
 * session_state issued alongside the current tokens. Deliberately has no server-side
 * effect (no session read/write beyond a lookup) - it's a read-only bridge between the
 * server-held session_state and the browser polling loop that has to run independently
 * of any particular page request.
 */
const handleSessionEndpoint: Handle = async ({event}) => {
    const {config, store, sessionId} = event.locals;

    const [identityJson] = await store.getMultiple(`session:${sessionId}`, ["identity"]);
    const identity = identityJson ? JSON.parse(identityJson) : null;

    if (!identity) {
        return json({authenticated: false});
    }

    if (!identity.sessionState) {
        // Authenticated, but there's no session_state to poll with - either the OP didn't
        // return one at sign-in, or this identity predates Session Management support
        // being added. Distinct from the unauthenticated case above: misreporting a
        // signed-in user as signed out here would be wrong, not just unsupported.
        return json({authenticated: true, sessionManagementSupported: false});
    }

    const configuration = await config.oidcConfiguration;
    const checkSessionIframe = configuration.serverMetadata().check_session_iframe;

    if (typeof checkSessionIframe !== "string") {
        // The OP didn't advertise Session Management support in its discovery document -
        // nothing for the client-side polling loop to do.
        return json({authenticated: true, sessionManagementSupported: false});
    }

    return json({
        authenticated: true,
        sessionManagementSupported: true,
        clientId: config.clientId,
        sessionState: identity.sessionState,
        checkSessionIframe,
    });
}

const BACKCHANNEL_LOGOUT_EVENT_CLAIM = "http://schemas.openid.net/event/backchannel-logout";

/**
 * Validates the claims a Logout Token is required to carry per the OpenID Connect
 * Back-Channel Logout 1.0 spec, beyond what jose.jwtVerify already checks (signature,
 * iss, aud, exp/iat freshness via maxTokenAge). Throws on the first violation found.
 */
const ValidateLogoutTokenClaims = (payload: jose.JWTPayload): void => {
    if ("nonce" in payload) {
        // A Logout Token MUST NOT contain a nonce claim - its presence would suggest this
        // is actually (a forged, or confused-deputy) ID Token, not a genuine Logout Token.
        throw new Error("Logout Token must not contain a nonce claim");
    }

    const events = payload.events;

    if (typeof events !== "object" || events === null || !(BACKCHANNEL_LOGOUT_EVENT_CLAIM in events)) {
        throw new Error("Logout Token missing the backchannel-logout events claim");
    }

    if (typeof payload.sub !== "string" && typeof payload.sid !== "string") {
        throw new Error("Logout Token must contain a sub or sid claim");
    }
}

/**
 * Receives the OP's server-to-server POST when a session ends at Keycloak (user signed
 * out elsewhere, admin action, session expiry) even if no browser tab is open to catch it
 * via check_session_iframe polling - the defense-in-depth complement to
 * OpenID Connect Session Management 1.0.
 *
 * Deliberately takes `event`/`config` as plain parameters rather than being a `Handle`
 * reading `event.locals`: it's invoked ahead of SessionMiddleware entirely (see
 * OidcMiddleware above), so `event.locals.store`/`config` are never populated for this
 * request.
 *
 * Session lookup only works when the Logout Token carries a `sid` claim - matched against
 * an index of sid -> our internal session id, written at sign-in/refresh time. A
 * `sub`-only Logout Token (no `sid`) is still a validly-signed, spec-compliant token, but
 * we have nothing to map it to: a naive sub-only index would only ever remember the most
 * recently signed-in session for that user, and could end up clearing the wrong one for a
 * user with multiple concurrent sessions - worse than doing nothing. That's still a 200
 * (the token itself is valid; there's simply no local session to act on), not a 400.
 *
 * Also only ever clears the session on *this* instance's session store - for a shared
 * store (RedisSessionStore) that's every instance behind it; for InMemorySessionStore
 * behind multiple horizontally-scaled instances, only the instance that happened to
 * receive this particular POST is affected (documented in the README).
 */
const handleBackchannelLogoutEndpoint = async (event: RequestEvent, config: InternalOidcConfig): Promise<Response> => {
    const formData = await event.request.formData().catch(() => null);
    const logoutToken = formData?.get("logout_token");

    if (typeof logoutToken !== "string") {
        return json({error: "invalid_request", error_description: "Missing logout_token"}, {status: 400});
    }

    try {
        const jwks = await config.remoteJWKSet;
        const {payload} = await jose.jwtVerify(logoutToken, jwks, {
            issuer: config.issuer,
            audience: config.clientId,
            maxTokenAge: "5m",
        });

        ValidateLogoutTokenClaims(payload);

        if (typeof payload.sid === "string") {
            const indexKey = `backchannel:sid:${payload.sid}`;
            const sessionId = await config.sessionStore.getSingle(indexKey);

            if (sessionId) {
                await config.sessionStore.delete(`session:${sessionId}`);
                await config.sessionStore.delete(indexKey);
            }
        }

        return new Response(null, {status: 200});
    } catch (e) {
        // Covers both a genuinely invalid Logout Token (bad signature, wrong iss/aud,
        // missing required claims) and infrastructure failures (JWKS temporarily
        // unreachable) - the spec only defines 200/400 for this endpoint, so both collapse
        // to the same 400 rather than inventing a status code Keycloak isn't expecting.
        return json({error: "invalid_request"}, {status: 400});
    }
}

const handleSignOutCallback: Handle = async ({event}) => {
    const {store} = event.locals;
    const state = event.url.searchParams.get('state');

    const challengeJson = state !== null ? await store.getSingle(`challenge:signOut:${state}`) : null;

    let redirectTo = event.url.origin;

    if (challengeJson !== null) {
        const challenge = JSON.parse(challengeJson);
        redirectTo = challenge.originalRedirectUri;
        await store.delete(`challenge:signOut:${state}`);
    }

    return new Response(null, {
        status: 307,
        headers: {
            Location: redirectTo,
        },
    });
}

const ValidateOidcConfiguration = (configuration: InternalOidcConfig): Array<string> => {
    const errors: Array<string> = [];

    if (configuration.cookie === undefined) {
        errors.push('Cookie is missing');
    }
    else {
        if (configuration.cookie.name === undefined) {
            errors.push('Cookie name is missing');
        }

        if (configuration.cookie.secure === undefined) {
            errors.push('Cookie secure is missing');
        }
    }

    if (!Number.isFinite(configuration.expireIn) || configuration.expireIn <= 0) {
        errors.push('expireIn must be a positive finite number (seconds)');
    }

    if (!Number.isFinite(configuration.size) || configuration.size < 128) {
        errors.push('Size is not a number or is less than 128');
    }

    if (!configuration.sessionGenerator) {
        errors.push('Session generator is missing');
    }

    if (!configuration.sessionHasher) {
        errors.push('Session hasher is missing');
    }

    if (!configuration.sessionStore) {
        errors.push('Session store is missing');
    }

    if (configuration.challenge === undefined) {
        errors.push('Challenge is missing');
    } else {
        if (configuration.challenge.signin === undefined) {
            errors.push('Signin challenge is missing');
        }
    }

    if (configuration.signin === undefined) {
        errors.push('Signin configuration is missing');
    }
    else {
        if (configuration.signin.endpoint === undefined) {
            errors.push('Signin endpoint is missing');
        }
        if (configuration.signin.page === undefined) {
            errors.push('Signin page is missing');
        }
        if (configuration.signin.callback === undefined) {
            errors.push('Signin callback is missing');
        }
    }

    if (configuration.signout === undefined) {
        errors.push('Signout configuration is missing');
    }
    else {
        if (configuration.signout.page === undefined) {
            errors.push('Signout page is missing');
        }
        if (configuration.signout.endpoint === undefined) {
            errors.push('Signout endpoint is missing');
        }
        if (configuration.signout.callback === undefined) {
            errors.push('Signout callback is missing');
        }
    }

    if (configuration.session === undefined) {
        errors.push('Session configuration is missing');
    }
    else {
        if (configuration.session.endpoint === undefined) {
            errors.push('Session endpoint is missing');
        }
    }

    if (configuration.backchannelLogout === undefined) {
        errors.push('Backchannel logout configuration is missing');
    }
    else {
        if (configuration.backchannelLogout.endpoint === undefined) {
            errors.push('Backchannel logout endpoint is missing');
        }
    }

    if (configuration.issuer === undefined) {
        errors.push('Issuer is missing');
    }

    if (configuration.clientId === undefined) {
        errors.push('Client id is missing');
    }

    if (configuration.clientSecret === undefined) {
        errors.push('Client secret is missing');
    }

    return errors;
}

export {
    OidcMiddleware,
}
