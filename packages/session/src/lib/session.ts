import { redirect, type Handle } from '@sveltejs/kit';
import type { InternalMiddlewareHandle, InternalSessionConfig, SessionConfig } from '$lib/types.js';
import { Defaults } from '$lib/config.js';
import type { ISessionStore } from '$lib/ISessionStore.js';
import type { ISessionHasher } from '$lib/ISessionHasher.js';
import type { ISessionGenerator } from '$lib/ISessionGenerator.js';
import { sequence } from '@sveltejs/kit/hooks';

/**
 * Session middleware.
 * @param sessionConfig
 * @constructor
 */
const SessionMiddleware = (sessionConfig?: SessionConfig): Handle => {
	const configuredSessionConfig: InternalSessionConfig = {
		...Defaults,
		...sessionConfig
	};

	const errors = ValidateSessionConfiguration(configuredSessionConfig);

	if (errors.length > 0) {
		console.error(errors);
		throw new Error('Invalid session config');
	}

	const handleSessionMiddleware: Handle = async (request) => {
		return handleSessionMiddlewareInternal(request, configuredSessionConfig);
	};

	const prepareSessionMiddleware: Handle = async (request) => {
		return handlePrepareSessionMiddleware(request, configuredSessionConfig);
	}
	return sequence(prepareSessionMiddleware, handleSessionMiddleware);
};

const handlePrepareSessionMiddleware: InternalMiddlewareHandle = async (
	{ event, resolve },
	options) => {
	event.locals.store = options.sessionStore;
	event.locals.hasher = options.sessionHasher;
	event.locals.generator = options.sessionGenerator;
	return resolve(event);
};
/**
 * Handle session middleware.
 * @param event
 * @param resolve
 * @param options
 */
const handleSessionMiddlewareInternal: InternalMiddlewareHandle = async (
	{ event, resolve },
	options
) => {
	const store: ISessionStore = event.locals.store;
	const hasher: ISessionHasher = event.locals.hasher;
	const generator: ISessionGenerator = event.locals.generator;

	// Skip favicon requests
	if (event.url.pathname === '/favicon.ico') {
		return resolve(event);
	}

	const cookieName = options.cookie;
	const expiresIn = options.expireIn;

	let cookieValue = event.cookies.get(cookieName);

	if (cookieValue !== undefined) {
		const sessionKey = `session:${cookieValue}`;

		if (await store.exists(sessionKey)) {
			const [identity, created] = await store.getMultiple(sessionKey, [
				'identity',
				'created'
			]);

			// populate session id & identity
			event.locals.sessionId = cookieValue;

			try {
				event.locals.session = {
					identity: identity ? JSON.parse(identity) : null,
					created
				};
			} catch (error) {
				event.locals.session = {
					identity: null,
					created
				};
			}

			return resolve(event);
		}
	}

	const sessionId = hasher.hash(generator.generate(options.size));
	const sessionKey = `session:${sessionId}`;

	await store.setMultiple(sessionKey, [
		'identity',
		JSON.stringify(null),
		'created',
		Date.now().toString()
	]);

	await store.expire(sessionKey, expiresIn);

	const currentDate = new Date();
	const expiredDate = new Date(currentDate.getTime() + options.expireIn * 1000);
	event.setHeaders({
		'Cache-Control': 'no-store'
	});

	event.cookies.set(cookieName, sessionId, {
		expires: expiredDate,
		path: '/',
		secure: true,
		sameSite: 'strict',
		httpOnly: true,
		priority: 'high'
	});

	// we have to redirect to write a cookie
	// we avoid issues with non-existing cookies in after middleware...
	// Redirect GET requests so the browser sends the cookie on the next request
	if (event.request.method === 'GET') {
		throw redirect(303, event.url); // 303 ensures subsequent request is GET
	}

	// Reject non-GET requests without an existing session.
	// Clients must establish a session via GET before performing mutations.
	return new Response(null, {
		status: 405
	});
};

/**
 * Validate session configuration.
 * @param configuration
 */
const ValidateSessionConfiguration = (configuration: InternalSessionConfig): Array<string> => {
	const errors: Array<string> = [];

	if (!configuration.cookie) {
		errors.push('Cookie is missing');
	}

	if (!Number.isFinite(configuration.expireIn) || configuration.expireIn <= 0) {
		errors.push('expireIn must be a positive finite number (seconds)');
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

	if (!Number.isFinite(configuration.size) || configuration.size < 128) {
		errors.push('Size is not a number or is less than 128');
	}

	return errors;
};

export { SessionMiddleware };
