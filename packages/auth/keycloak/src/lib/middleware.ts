import type {InternalMiddlewareHandle, InternalOidcConfig, OidcConfig} from "$lib/types.js";
import {type Handle, json} from "@sveltejs/kit";
import {sequence} from "@sveltejs/kit/hooks";
import {SessionMiddleware} from "@escendit/sveltekit-session";
import {Defaults} from "$lib/config.js";
import {KeyCloak} from "arctic";
import * as arctic from "arctic";
import * as jose from "jose";

const OidcMiddleware: any = (config?: OidcConfig): Handle => {

    const configuredSessionConfig: InternalOidcConfig = {
        ...Defaults,
        ...config,
    };

    /*const errors = ValidateSessionConfiguration(configuredSessionConfig);

    if (errors.length > 0) {
        console.error(errors);
        throw new Error('Invalid oidc config');
    }*/

    const handleOidcMiddleware: Handle = async (request) => {
        return handleOidcMiddlewareInternal(request, configuredSessionConfig);
    };

    return sequence(SessionMiddleware(configuredSessionConfig), handleOidcMiddleware);
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

    if (identity) {
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
        case `${config.signout?.page}`:
            return handleSignOutPage(request);
        case `${config.signout?.endpoint}`:
            return handleSignOutEndpoint(request);
        case `${config.signout?.callback}`:
            return handleSignOutCallback(request);
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
    const {config, store, hasher, generator, sessionId} = event.locals;
    const relativeSignInCallback = config.signin?.callback;
    const issuer = config.issuer;
    const clientId = config.clientId;
    const clientSecret = config.clientSecret;

    // get current session data if they exist
    const [identityJson, _] = await store.getMultiple(`session:${sessionId}`, ["identity", "created"]);
    const identity = identityJson ? JSON.parse(identityJson) : null;

    if (identity !== null) {
        return resolve(event);
    }

    let parsedRedirectUri = event.url.searchParams.get('redirect_uri');

    if (parsedRedirectUri === null) {
        parsedRedirectUri = new URL(`${event.url.origin}`).toString();
    }

    // create the challenge
    const originalRedirectUri = parsedRedirectUri;
    const state = arctic.generateState();
    const codeVerifier = arctic.generateCodeVerifier();
    const challengeId = hasher.hash(generator.generate(config.size));
    const scopes = ['openid', 'profile'];
    const redirectUri = `${event.url.origin}${relativeSignInCallback}?challenge=${challengeId}`;

    const challenge = {
        state,
        codeVerifier,
        originalRedirectUri,
        redirectUri,
        scopes,
    }

    // store the challenge
    await store.setSingle(`challenge:signIn:${challengeId}`, JSON.stringify(challenge));

    // build authorization url
    const identityProvider = new KeyCloak(issuer, clientId, clientSecret, redirectUri);
    const authorizationUri = identityProvider.createAuthorizationURL(state, codeVerifier, scopes);

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
    const clientId = config.clientId;
    const clientSecret = config.clientSecret;
    const {
        challenge: challengeId,
        state,
        session_state,
        iss,
        code,
    } = Object.fromEntries(event.url.searchParams.entries());


    const challengeJson = await store.getSingle(`challenge:signIn:${challengeId}`);

    if (challengeJson === null) {
        return json({
                "error": "invalid_challenge",
            },
            {
                status: 400,
            });
    }

    const challenge = JSON.parse(challengeJson);

    if (state !== challenge?.state) {
        validationErrors.push("State mismatched");
    }

    if (iss !== issuer) {
        validationErrors.push("Issuer mismatched");
    }

    if (validationErrors.length > 0) {
        await store.delete(`challenge:signIn:${challengeId}`);
        return json(
            {
                error: "invalid_callback",
            },
            {
                status: 400,
            },
        );
    }

    const identityProvider = new KeyCloak(issuer, clientId, clientSecret, challenge.redirectUri);

    try {
        const data = await identityProvider.validateAuthorizationCode(code, challenge.codeVerifier);

        const accessToken = jose.decodeJwt(data.accessToken());
        const refreshToken = jose.decodeJwt(data.refreshToken());
        const idToken = jose.decodeJwt(data.idToken());

        const sessionData = {
            authenticated: true,
            validationErrors,
            accessTokenRaw: data.accessToken(),
            accessTokenExpiresAt: data.accessTokenExpiresAt(),
            accessTokenExpiresInSeconds: data.accessTokenExpiresInSeconds(),
            refreshTokenRaw: data.refreshToken(),
            idTokenRaw: data.idToken(),
            tokenType: data.tokenType(),
            scopes: data.scopes(),
            sessionState: session_state,
            // expand data
            accessToken: accessToken,
            refreshToken: refreshToken,
            idToken: idToken,
        };

        const identityJson = JSON.stringify(sessionData);

        // delete challenge data, after a successful challenge
        await store.delete(`challenge:signIn:${challengeId}`);

        // mark the user for a session.
        await store.setMultiple(`session:${sessionId}`, [
            "identity",
            identityJson,
        ])

        // redirect back to a starting point
        return new Response(null, {
            status: 307,
            headers: {
                Location: challenge.originalRedirectUri,
            },
        });
    }
    catch (e) {
        if (e instanceof arctic.OAuth2RequestError) {
        }
        if (e instanceof arctic.ArcticFetchError) {
        }

        await store.delete(`challenge:signIn:${challengeId}`);
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

const handleSignOutEndpoint: Handle = async ({event, resolve}) => {
    return resolve(event);
}

const handleSignOutCallback: Handle = async ({event, resolve}) => {
    return resolve(event);
}

export {
    OidcMiddleware,
}
