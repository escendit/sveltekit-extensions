import type { ISessionGenerator } from '$lib/ISessionGenerator.js';
import crypto from "node:crypto";

/**
 * Default session generator.
 */
export class DefaultSessionGenerator implements ISessionGenerator {
	/**
	 * Generate a session key.
	 * @param size
	 */
    generate(size: number): Uint8Array {
        return crypto.randomBytes(size);
    }
}