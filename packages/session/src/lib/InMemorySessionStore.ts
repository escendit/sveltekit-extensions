import type { ISessionStore } from '$lib/ISessionStore.js';

/**
 * In memory session store
 */
export class InMemorySessionStore implements ISessionStore {
	private readonly datastore: Record<string, Record<string, string | null> | undefined>;
	private readonly expirations: Record<string, number | undefined>;

	public constructor() {
		this.datastore = {};
		this.expirations = {};
	}

    delete(sessionKey: string): Promise<void> {
        delete this.datastore[sessionKey];
        delete this.expirations[sessionKey];
        return Promise.resolve();
    }

	exists(sessionKey: string): Promise<boolean> {
		// Validate input!
		if (sessionKey === undefined || sessionKey === null) {
			return Promise.reject(new Error(`Session key "${sessionKey}" is not valid.`));
		}

		// Does it exist?
		const result = this.datastore[sessionKey];

		if (result === undefined) {
			return Promise.resolve(false);
		}

		const expires = this.expirations[sessionKey];

		if (expires === undefined) {
			return Promise.resolve(true);
		}

		if (Date.now() > expires) {
			// we can also remove session keys if they're expired
			delete this.datastore[sessionKey];
			delete this.expirations[sessionKey];
			// report that session doesn't exist, since the current time is beyond expiration's time
			return Promise.resolve(false);
		}

		return Promise.resolve(true);
	}
	expire(sessionKey: string, seconds: number): Promise<number> {
		this.expirations[sessionKey] = Date.now() + seconds * 1000;
		return Promise.resolve(seconds);
	}
	getSingle(sessionKey: string): Promise<string | null> {
		if (this.datastore[sessionKey] === undefined) {
			return Promise.resolve(null);
		}

		const session = this.datastore[sessionKey]?.['default'] ?? null;
		return Promise.resolve(session);
	}
	setSingle(sessionKey: string, value: string): Promise<string> {
		// check if session exists, and create empty object.
		if (this.datastore[sessionKey] === undefined) {
			this.datastore[sessionKey] = {};
		}

		this.datastore[sessionKey]['default'] = value;
		return Promise.resolve('OK');
	}
	getMultiple(sessionKey: string, values: Array<string>): Promise<Array<string | null>> {
		const results: Array<string | null> = [];

		if (this.datastore[sessionKey] === undefined) {
			this.datastore[sessionKey] = {};
		}

		for (const key of values) {
			results.push(this.datastore[sessionKey][key]);
		}

		return Promise.resolve(results);
	}
	setMultiple(sessionKey: string, values: Array<string>): Promise<string> {
		if (values.length % 2 !== 0) {
			return Promise.reject('Invalid values count');
		}

		if (this.datastore[sessionKey] === undefined || this.datastore[sessionKey] === null) {
			// fill
			this.datastore[sessionKey] = {};
		}

		for (let i = 0; i < values.length; i += 2) {
			const key = values[i];
			const value = values[i + 1];

			if (key === undefined || key === null) {
				return Promise.reject(`key "${key}" is required`);
			}

			this.datastore[sessionKey]![key] = value;
		}

		return Promise.resolve('OK');
	}
}
