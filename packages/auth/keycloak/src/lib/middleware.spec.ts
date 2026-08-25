import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as client from 'openid-client';
import * as jose from 'jose';
import type { ISessionStore } from '@escendit/sveltekit-session';
import type { Handle, RequestEvent } from '@sveltejs/kit';
// @sveltejs/kit's own `sequence()` (used internally by both SessionMiddleware and
// OidcMiddleware) reads the current request out of an AsyncLocalStorage-backed "request
// store" rather than purely off the event argument. Outside of SvelteKit's own server
// request handling nothing ever establishes that store, so a hand-constructed event alone
// isn't enough to invoke a sequence()-composed Handle - this is the same internal entry
// point SvelteKit's server runtime uses to set it up before calling `handle`.
import { with_request_store } from '@sveltejs/kit/internal/server';
import { OidcMiddleware } from './middleware.js';

type Resolve = (event: RequestEvent) => Promise<Response>;

const invokeHandle = (handle: Handle, event: RequestEvent, resolve: Resolve) => {
	const state = {
		tracing: {
			record_span: ({ fn }: { fn: (current: unknown) => unknown }) => fn({})
		}
	};
	return with_request_store({ event, state } as never, () => handle({ event, resolve } as never));
};

/**
 * A minimal, self-contained ISessionStore instead of the real InMemorySessionStore.
 * @escendit/sveltekit-session's package entry unconditionally imports RedisSessionStore,
 * which does `import { redis } from "bun"` at module load - that's fine under Bun's own
 * resolver, but crashes when the package is loaded through Vite's SSR module graph (as
 * vitest does here), which doesn't know how to resolve the `bun` specifier. Importing
 * *anything* from the package index re-triggers that crash, so this test avoids importing
 * the package at runtime entirely (only its `ISessionStore` type, which is erased).
 */
class FakeSessionStore implements ISessionStore {
	private readonly fields = new Map<string, Map<string, string>>();

	async exists(sessionKey: string): Promise<boolean> {
		return this.fields.has(sessionKey);
	}

	async expire(_sessionKey: string, seconds: number): Promise<number> {
		return seconds;
	}

	async getSingle(sessionKey: string): Promise<string | null> {
		return this.fields.get(sessionKey)?.get('default') ?? null;
	}

	async setSingle(sessionKey: string, value: string): Promise<string> {
		this.set(sessionKey, 'default', value);
		return value;
	}

	async getMultiple(sessionKey: string, values: Array<string>): Promise<Array<string | null>> {
		const bucket = this.fields.get(sessionKey);
		return values.map((field) => bucket?.get(field) ?? null);
	}

	async setMultiple(sessionKey: string, values: Array<string>): Promise<string> {
		for (let i = 0; i < values.length; i += 2) {
			this.set(sessionKey, values[i], values[i + 1]);
		}
		return sessionKey;
	}

	async delete(sessionKey: string): Promise<void> {
		this.fields.delete(sessionKey);
	}

	private set(sessionKey: string, field: string, value: string) {
		if (!this.fields.has(sessionKey)) {
			this.fields.set(sessionKey, new Map());
		}
		this.fields.get(sessionKey)!.set(field, value);
	}
}

vi.mock('openid-client', async (importOriginal) => {
	const actual = await importOriginal<typeof import('openid-client')>();
	return {
		...actual,
		discovery: vi.fn(),
		refreshTokenGrant: vi.fn(),
		buildEndSessionUrl: vi.fn()
	};
});

// Only createRemoteJWKSet is mocked - jwtVerify, SignJWT, decodeJwt etc. all stay real, so
// Back-Channel Logout tests exercise genuine signature/claim verification against a
// locally-generated test keypair instead of hitting a real jwks_uri over the network.
vi.mock('jose', async (importOriginal) => {
	const actual = await importOriginal<typeof import('jose')>();
	return {
		...actual,
		createRemoteJWKSet: vi.fn()
	};
});

/**
 * jose.decodeJwt only base64url-decodes the payload segment - it never verifies a
 * signature - so a structurally valid but unsigned token is enough to exercise the
 * middleware's decode step without a real Keycloak issuer.
 */
const fakeJwt = (payload: Record<string, unknown>): string => {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'none' })}.${encode(payload)}.`;
};

const baseConfig = () => ({
	sessionStore: new FakeSessionStore(),
	// Only the "existing session" read path is exercised in these tests, which uses the
	// raw cookie value directly as the session id - the hasher/generator are only invoked
	// on the "new session" creation path, so trivial stubs satisfy config validation.
	sessionHasher: { hash: () => '' },
	sessionGenerator: { generate: () => new Uint8Array() },
	cookie: { name: 'session.id', secure: false }
});

const makeEvent = (pathname: string, sessionId: string) => {
	const url = new URL(`http://localhost${pathname}`);
	return {
		url,
		request: { method: 'GET' },
		cookies: {
			get: (_name: string) => sessionId,
			set: () => {},
			delete: () => {}
		},
		setHeaders: () => {},
		locals: {} as Record<string, unknown>
	};
};

beforeEach(() => {
	vi.mocked(client.discovery).mockResolvedValue({} as never);
});

describe('sign-out', () => {
	it('clears the local session and redirects to the discovered end_session_endpoint', async () => {
		const config = baseConfig();
		const sessionId = 'sess-signout-1';
		const sessionKey = `session:${sessionId}`;
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify({ authenticated: true, idTokenRaw: 'id-token-raw' }),
			'created',
			Date.now().toString()
		]);

		vi.mocked(client.buildEndSessionUrl).mockReturnValue(
			new URL('https://idp.example.com/realms/test/logout?state=abc')
		);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/signout', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;

		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe(
			'https://idp.example.com/realms/test/logout?state=abc'
		);
		expect(await config.sessionStore.exists(sessionKey)).toBe(false);
		// The local session must already be gone before the IdP round trip even starts.
		expect(resolve).not.toHaveBeenCalled();
	});

	it('clears the session and redirects locally when no end_session_endpoint is available', async () => {
		const config = baseConfig();
		const sessionId = 'sess-signout-2';
		const sessionKey = `session:${sessionId}`;
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify({ authenticated: true }),
			'created',
			Date.now().toString()
		]);

		vi.mocked(client.buildEndSessionUrl).mockImplementation(() => {
			throw new Error('no end_session_endpoint in discovery document');
		});

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/signout?redirect_uri=/dashboard', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;

		expect(response.status).toBe(307);
		expect(response.headers.get('location')).toBe('http://localhost/dashboard');
		expect(await config.sessionStore.exists(sessionKey)).toBe(false);
	});
});

describe('access-token refresh', () => {
	it('leaves a still-valid access token untouched and resolves normally', async () => {
		const config = baseConfig();
		const sessionId = 'sess-refresh-valid';
		const sessionKey = `session:${sessionId}`;
		const identity = {
			authenticated: true,
			accessTokenRaw: 'still-valid',
			accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
			refreshTokenRaw: 'refresh-raw'
		};
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify(identity),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/', sessionId);
		const resolve = vi.fn(async (e: typeof event) => {
			expect((e.locals.session as { identity: typeof identity }).identity.accessTokenRaw).toBe(
				'still-valid'
			);
			return new Response('resolved');
		});

		await invokeHandle(handle, event as never, resolve);

		expect(client.refreshTokenGrant).not.toHaveBeenCalled();
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('refreshes an expired access token and updates the session before resolving', async () => {
		const config = baseConfig();
		const sessionId = 'sess-refresh-expired';
		const sessionKey = `session:${sessionId}`;
		const identity = {
			authenticated: true,
			accessTokenRaw: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
			refreshTokenRaw: 'refresh-raw',
			sessionState: 'session-state-1'
		};
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify(identity),
			'created',
			Date.now().toString()
		]);

		const rotatedAccessToken = fakeJwt({ sub: 'user-1', jti: 'rotated-access' });
		const rotatedRefreshToken = fakeJwt({ sub: 'user-1', jti: 'rotated-refresh' });
		vi.mocked(client.refreshTokenGrant).mockResolvedValue({
			access_token: rotatedAccessToken,
			refresh_token: rotatedRefreshToken,
			id_token: fakeJwt({ sub: 'user-1' }),
			token_type: 'Bearer',
			scope: 'openid profile',
			expiresIn: () => 300
		} as never);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		await invokeHandle(handle, event as never, resolve);

		expect(client.refreshTokenGrant).toHaveBeenCalledWith(expect.anything(), 'refresh-raw');

		// event.locals.session.identity is a one-shot snapshot taken before the OIDC
		// handler ran - it must be overwritten with the refresh outcome, or downstream
		// load functions/endpoints would keep seeing the expired token.
		const localsIdentity = (event.locals.session as { identity: Record<string, unknown> })
			.identity;
		expect(localsIdentity.accessTokenRaw).toBe(rotatedAccessToken);
		expect(localsIdentity.refreshTokenRaw).toBe(rotatedRefreshToken);

		const [storedIdentityJson] = await config.sessionStore.getMultiple(sessionKey, ['identity']);
		const storedIdentity = JSON.parse(storedIdentityJson as string);
		expect(storedIdentity.refreshTokenRaw).toBe(rotatedRefreshToken);
		expect(storedIdentity.accessTokenRaw).toBe(rotatedAccessToken);

		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('clears the session and falls through to unauthenticated handling when the refresh token is rejected', async () => {
		const config = baseConfig();
		const sessionId = 'sess-refresh-rejected';
		const sessionKey = `session:${sessionId}`;
		const identity = {
			authenticated: true,
			accessTokenRaw: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
			refreshTokenRaw: 'revoked-refresh-token'
		};
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify(identity),
			'created',
			Date.now().toString()
		]);

		vi.mocked(client.refreshTokenGrant).mockRejectedValue(
			new client.ResponseBodyError('invalid_grant', {
				cause: { error: 'invalid_grant', error_description: 'Token is not active' },
				response: new Response(null, { status: 400 })
			})
		);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/', sessionId);
		const resolve = vi.fn(async (e: typeof event) => {
			// Falls through to the unauthenticated path with no signin challenge configured,
			// so it resolves rather than redirecting - but the stale authenticated snapshot
			// must already be cleared by the time it does.
			expect((e.locals.session as { identity: unknown }).identity).toBeNull();
			return new Response('resolved');
		});

		await invokeHandle(handle, event as never, resolve);

		expect(await config.sessionStore.exists(sessionKey)).toBe(false);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it('reuses a concurrently-refreshed session instead of logging the user out on a rotation race', async () => {
		const config = baseConfig();
		const sessionId = 'sess-refresh-race';
		const sessionKey = `session:${sessionId}`;
		const identity = {
			authenticated: true,
			accessTokenRaw: 'expired-access-token',
			accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
			refreshTokenRaw: 'refresh-token-that-lost-the-race'
		};
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify(identity),
			'created',
			Date.now().toString()
		]);

		vi.mocked(client.refreshTokenGrant).mockImplementation(async () => {
			// Simulate a concurrent request winning the rotation race and persisting its
			// own refreshed identity to the store before this one's grant is rejected.
			const winnerIdentity = { ...identity, refreshTokenRaw: 'refresh-token-that-won' };
			await config.sessionStore.setMultiple(sessionKey, [
				'identity',
				JSON.stringify(winnerIdentity)
			]);
			throw new client.ResponseBodyError('invalid_grant', {
				cause: { error: 'invalid_grant', error_description: 'Token already used' },
				response: new Response(null, { status: 400 })
			});
		});

		const handle = OidcMiddleware(config);
		const event = makeEvent('/', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		await invokeHandle(handle, event as never, resolve);

		// The session must survive - the loser of the race should not delete a session
		// another request already successfully refreshed.
		expect(await config.sessionStore.exists(sessionKey)).toBe(true);
		const localsIdentity = (event.locals.session as { identity: Record<string, unknown> })
			.identity;
		expect(localsIdentity.refreshTokenRaw).toBe('refresh-token-that-won');
		expect(resolve).toHaveBeenCalledTimes(1);
	});
});

describe('OIDC discovery failure', () => {
	// Whether an unattached rejected promise actually crashes the process is verified
	// separately, end-to-end: before this fix, `bun run test:e2e` in this package crashed
	// the preview server outright on startup (the demo app's default issuer is
	// unreachable); after it, the server survives and the demo test passes. That can't be
	// reliably observed from inside a single vitest worker process, which already installs
	// its own process-wide unhandledRejection handling to keep unrelated failures from
	// taking down the whole test run - so a rejected promise with zero attached handlers
	// here doesn't actually reproduce the crash this fix addresses. What *is* reliably
	// unit-testable is the other half of the fix: that attaching a no-op handler to
	// silence the unhandled-rejection crash must not also swallow the failure for real
	// per-request consumers - it must still propagate normally to them.
	it('still surfaces a discovery failure to per-request consumers instead of silently swallowing it', async () => {
		const discoveryError = new TypeError('fetch failed');
		vi.mocked(client.discovery).mockReturnValueOnce(Promise.reject(discoveryError));

		const config = baseConfig();
		const sessionId = 'sess-discovery-failure';
		const sessionKey = `session:${sessionId}`;
		// An existing but unauthenticated session, so the middleware routes to the sign-in
		// endpoint (which awaits config.oidcConfiguration) instead of short-circuiting.
		await config.sessionStore.setMultiple(sessionKey, [
			'identity',
			JSON.stringify(null),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/signin', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		await expect(invokeHandle(handle, event as never, resolve)).rejects.toThrow(discoveryError);
	});
});

describe('session endpoint (OpenID Connect Session Management 1.0)', () => {
	it('reports unauthenticated for a session with no identity', async () => {
		const config = baseConfig();
		const sessionId = 'sess-session-endpoint-unauth';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify(null),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/session', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(await response.json()).toEqual({authenticated: false});
		expect(resolve).not.toHaveBeenCalled();
	});

	it('reports authenticated without session-management support for a signed-in identity with no sessionState, rather than misreporting it as unauthenticated', async () => {
		const config = baseConfig();
		const sessionId = 'sess-session-endpoint-no-state';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify({authenticated: true}),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/session', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(await response.json()).toEqual({authenticated: true, sessionManagementSupported: false});
	});

	it('reports authenticated without session-management support when the OP does not advertise check_session_iframe', async () => {
		vi.mocked(client.discovery).mockResolvedValueOnce({
			serverMetadata: () => ({})
		} as never);

		const config = baseConfig();
		const sessionId = 'sess-session-endpoint-no-iframe';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify({authenticated: true, sessionState: 'abc123'}),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/session', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(await response.json()).toEqual({authenticated: true, sessionManagementSupported: false});
	});

	it('returns clientId, sessionState, and checkSessionIframe when the OP supports Session Management', async () => {
		vi.mocked(client.discovery).mockResolvedValueOnce({
			serverMetadata: () => ({check_session_iframe: 'https://idp.example.com/realms/test/check-session'})
		} as never);

		const config = baseConfig();
		const sessionId = 'sess-session-endpoint-supported';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify({authenticated: true, sessionState: 'abc123'}),
			'created',
			Date.now().toString()
		]);

		const handle = OidcMiddleware(config);
		const event = makeEvent('/.oidc/session', sessionId);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(await response.json()).toEqual({
			authenticated: true,
			sessionManagementSupported: true,
			clientId: 'invalid-client',
			sessionState: 'abc123',
			checkSessionIframe: 'https://idp.example.com/realms/test/check-session'
		});
	});
});

describe('Back-Channel Logout', () => {
	const ISSUER = 'https://invalid.keycloak.org/realms/master'; // matches Defaults.issuer
	const CLIENT_ID = 'invalid-client'; // matches Defaults.clientId
	const JWKS_URI = 'https://idp.example.com/realms/test/protocol/openid-connect/certs';
	const BACKCHANNEL_LOGOUT_EVENTS_CLAIM = 'http://schemas.openid.net/event/backchannel-logout';

	let signingKey: CryptoKey;
	let otherKey: CryptoKey;

	beforeAll(async () => {
		const keyPair = await jose.generateKeyPair('RS256');
		signingKey = keyPair.privateKey;

		const publicJwk = await jose.exportJWK(keyPair.publicKey);
		publicJwk.alg = 'RS256';
		publicJwk.use = 'sig';
		const localJwks = jose.createLocalJWKSet({ keys: [publicJwk] });
		vi.mocked(jose.createRemoteJWKSet).mockReturnValue(localJwks as never);

		// A second, unrelated keypair - signing with this instead of `signingKey` produces
		// a token that fails signature verification against the mocked JWKS above.
		otherKey = (await jose.generateKeyPair('RS256')).privateKey;
	});

	beforeEach(() => {
		vi.mocked(client.discovery).mockResolvedValue({
			serverMetadata: () => ({ jwks_uri: JWKS_URI })
		} as never);
	});

	const signLogoutToken = async (
		payload: Record<string, unknown>,
		options: { key?: CryptoKey; issuer?: string; audience?: string } = {}
	): Promise<string> => {
		const jwt = new jose.SignJWT(payload)
			.setProtectedHeader({ alg: 'RS256' })
			.setIssuedAt()
			.setIssuer(options.issuer ?? ISSUER)
			.setAudience(options.audience ?? CLIENT_ID);

		return jwt.sign(options.key ?? signingKey);
	};

	const makeBackchannelEvent = (logoutToken: string | undefined) => {
		const url = new URL('http://localhost/.oidc/backchannel-logout');
		const body = new URLSearchParams();
		if (logoutToken !== undefined) body.set('logout_token', logoutToken);

		return {
			url,
			request: new Request(url, { method: 'POST', body }),
			cookies: { get: () => undefined, set: () => {}, delete: () => {} },
			setHeaders: () => {},
			locals: {} as Record<string, unknown>
		};
	};

	it('clears the matching local session when the Logout Token carries a known sid', async () => {
		const config = baseConfig();
		const sessionId = 'sess-backchannel-1';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify({ authenticated: true }),
			'created',
			Date.now().toString()
		]);
		await config.sessionStore.setSingle('backchannel:sid:sid-1', sessionId);

		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			sid: 'sid-1',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;

		expect(response.status).toBe(200);
		expect(await config.sessionStore.exists(`session:${sessionId}`)).toBe(false);
		expect(await config.sessionStore.getSingle('backchannel:sid:sid-1')).toBeNull();
		expect(resolve).not.toHaveBeenCalled();
	});

	it('responds 200 for a valid token whose sid has no matching local session', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			sid: 'sid-unknown',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(200);
	});

	it('responds 200 for a valid token with only sub (no sid), even though nothing local can be cleared', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(200);
	});

	it('rejects a request with no logout_token', async () => {
		const config = baseConfig();
		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(undefined);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(400);
	});

	it('rejects a Logout Token containing a nonce claim', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			sid: 'sid-1',
			nonce: 'should-not-be-here',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(400);
	});

	it('rejects a Logout Token missing the backchannel-logout events claim', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken({ sub: 'user-1', sid: 'sid-1' });

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(400);
	});

	it('rejects a Logout Token signed with a different key than the OP publishes', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken(
			{ sub: 'user-1', sid: 'sid-1', events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} } },
			{ key: otherKey }
		);

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(400);
	});

	it('rejects a Logout Token from an unexpected issuer', async () => {
		const config = baseConfig();
		const logoutToken = await signLogoutToken(
			{ sub: 'user-1', sid: 'sid-1', events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} } },
			{ issuer: 'https://not-the-configured-issuer.example.com' }
		);

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;
		expect(response.status).toBe(400);
	});

	it('responds 503, not 400, when the JWKS/discovery infrastructure is unreachable', async () => {
		// A completely valid, well-formed token - the failure here is purely that
		// discovery itself never resolves, so remoteJWKSet rejects.
		// mockRejectedValue (unlike `mockReturnValue(Promise.reject(...))`) creates the
		// rejected promise fresh at call time, not at mock-setup time - avoiding a timing
		// gap between the promise existing and OidcMiddleware's own .catch() attaching to
		// it that would otherwise trip vitest's unhandled-rejection detection.
		vi.mocked(client.discovery).mockRejectedValue(new TypeError('fetch failed'));

		const config = baseConfig();
		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			sid: 'sid-1',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;

		// A 400 here would tell Keycloak this valid token was invalid, and it might give
		// up retrying a genuine logout event over what was really our own outage.
		expect(response.status).toBe(503);
	});

	it('responds 503, not 400, when the session store fails while clearing a matched session', async () => {
		const config = baseConfig();
		const sessionId = 'sess-backchannel-store-failure';
		await config.sessionStore.setMultiple(`session:${sessionId}`, [
			'identity',
			JSON.stringify({ authenticated: true }),
			'created',
			Date.now().toString()
		]);
		await config.sessionStore.setSingle('backchannel:sid:sid-1', sessionId);
		vi.spyOn(config.sessionStore, 'delete').mockRejectedValue(new Error('store unavailable'));

		const logoutToken = await signLogoutToken({
			sub: 'user-1',
			sid: 'sid-1',
			events: { [BACKCHANNEL_LOGOUT_EVENTS_CLAIM]: {} }
		});

		const handle = OidcMiddleware(config);
		const event = makeBackchannelEvent(logoutToken);
		const resolve = vi.fn(async () => new Response('resolved'));

		const response = (await invokeHandle(handle, event as never, resolve)) as Response;

		// The token itself was valid - a store failure while acting on it is our problem,
		// not grounds to tell Keycloak the token was bad.
		expect(response.status).toBe(503);
	});
});

describe('allowInsecureRequests', () => {
	beforeEach(() => {
		vi.mocked(client.discovery).mockClear();
	});

	it('does not pass an execute option to discovery() by default', () => {
		OidcMiddleware(baseConfig());

		expect(client.discovery).toHaveBeenCalledWith(
			expect.any(URL),
			expect.any(String),
			expect.any(String),
			undefined,
			undefined
		);
	});

	it('passes execute: [allowInsecureRequests] to discovery() when explicitly enabled', () => {
		OidcMiddleware({ ...baseConfig(), allowInsecureRequests: true });

		expect(client.discovery).toHaveBeenCalledWith(
			expect.any(URL),
			expect.any(String),
			expect.any(String),
			undefined,
			{ execute: [client.allowInsecureRequests] }
		);
	});
});
