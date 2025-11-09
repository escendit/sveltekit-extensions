import type { ISessionStore } from '$lib/ISessionStore.js';
import {redis, type RedisClient} from "bun";

/**
 * Redis session store
 */
export class RedisSessionStore implements ISessionStore {
    private readonly client: RedisClient;
    public constructor() {
        this.client = redis;
    }
	exists(sessionKey: string): Promise<boolean> {
        return this.client.exists(sessionKey);
	}
	expire(sessionKey: string, seconds: number): Promise<number> {
        return this.client.expire(sessionKey, seconds);
	}
	getSingle(sessionKey: string): Promise<string | null> {
        return this.client.get(sessionKey);
	}
	setSingle(sessionKey: string, value: string): Promise<string> {
        return this.client.set(sessionKey, value);
	}
	getMultiple(sessionKey: string, values: Array<string>): Promise<Array<string | null>> {
        return this.client.hmget(sessionKey, values)!;
	}
	setMultiple(sessionKey: string, values: Array<string>): Promise<string> {
        return this.client.hmset(sessionKey, values);
	}
}
