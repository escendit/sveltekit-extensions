/**
 * Session generator interface
 */
export interface ISessionGenerator {
	/**
	 * Generate a session key.
	 * @param size
	 */
    generate(size: number): Uint8Array;
}