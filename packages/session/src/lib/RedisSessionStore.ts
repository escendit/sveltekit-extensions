import type { ISessionStore } from '$lib/ISessionStore.js';
import type { RedisClient } from "bun";

/**
 * Redis session store. The `bun` runtime module is loaded lazily (on first use) rather
 * than via a static top-level import, so that merely importing this package's entry point
 * doesn't require the Bun runtime - only actually constructing a RedisSessionStore does. A
 * static `import ... from "bun"` here made the whole package unloadable outside Bun's own
 * module resolver (e.g. plain Node, or Vite's SSR module graph under vitest), even for
 * consumers who only ever wanted InMemorySessionStore.
 */
export class RedisSessionStore implements ISessionStore {
    private clientPromise: Promise<RedisClient> | undefined;

    private getClient(): Promise<RedisClient> {
        if (!this.clientPromise) {
            this.clientPromise = import("bun").then(({ redis }) => redis);
        }
        return this.clientPromise;
    }

    async delete(sessionKey: string): Promise<void> {
        const client = await this.getClient();
        await client.del(sessionKey);
    }
	async exists(sessionKey: string): Promise<boolean> {
        const client = await this.getClient();
        return client.exists(sessionKey);
	}
	async expire(sessionKey: string, seconds: number): Promise<number> {
        const client = await this.getClient();
        return client.expire(sessionKey, seconds);
	}
	async getSingle(sessionKey: string): Promise<string | null> {
        const client = await this.getClient();
        return client.get(sessionKey);
	}
	async setSingle(sessionKey: string, value: string): Promise<string> {
        const client = await this.getClient();
        return client.set(sessionKey, value);
	}
	async getMultiple(sessionKey: string, values: Array<string>): Promise<Array<string | null>> {
        const client = await this.getClient();
        return client.hmget(sessionKey, values)!;
	}
	async setMultiple(sessionKey: string, values: Array<string>): Promise<string> {
        const client = await this.getClient();
        return client.hmset(sessionKey, values);
	}
}
