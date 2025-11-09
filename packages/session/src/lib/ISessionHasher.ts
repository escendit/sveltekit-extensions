/**
 * Session hasher interface.
 */
export interface ISessionHasher {
	/**
	 * Hash a binary array from a buffer.
	 * @param buffer
	 */
    hash(buffer: Uint8Array): string;
}