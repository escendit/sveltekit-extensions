import type { ISessionHasher } from '$lib/ISessionHasher.js';
import {binary_to_base58} from "base58-js";

/**
 * Default session hasher.
 */
export class DefaultSessionHasher implements ISessionHasher {
	/**
	 * Hash a binary array from a buffer.
	 * @param buffer
	 */
    hash(buffer: Uint8Array): string {
        return binary_to_base58(buffer);
    }
}