/**
 * Session store interface
 */
export interface ISessionStore {
	/**
	 * Check if a session exists.
	 * @param sessionKey
	 * @returns {Promise<boolean>}
	 */
    exists(sessionKey: string): Promise<boolean>;

	/**
	 * Expire a session.
	 * @param sessionKey
	 * @param seconds
	 * @returns {Promise<number>}
	 */
    expire(sessionKey: string, seconds: number): Promise<number>;

	/**
	 * Get a single session value.
	 * @param sessionKey
	 * @returns {Promise<string | null>}
	 */
    getSingle(sessionKey: string): Promise<string | null>;

	/**
	 * Set a single session value.
	 * @param sessionKey
	 * @param value
	 * @returns {Promise<string>}
	 */
    setSingle(sessionKey: string, value: string): Promise<string>;

	/**
	 * Get multiple session values.
	 * @param sessionKey
	 * @param values
	 * @returns {Promise<Array<string | null>>}
	 */
    getMultiple(sessionKey: string, values: Array<string>): Promise<Array<string | null>>;

	/**
	 * Set multiple session values.
	 * @param sessionKey
	 * @param values
	 * @returns {Promise<string>}
	 */
    setMultiple(sessionKey: string, values: Array<string>): Promise<string>;
}
