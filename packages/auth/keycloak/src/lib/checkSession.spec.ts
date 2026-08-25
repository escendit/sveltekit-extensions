import { describe, it, expect } from 'vitest';
import { parseSessionCheckMessage } from './checkSession.js';

describe('parseSessionCheckMessage', () => {
	it.each(['unchanged', 'changed', 'error'] as const)('accepts the spec-defined status %s', (status) => {
		expect(parseSessionCheckMessage(status)).toBe(status);
	});

	it('rejects non-string payloads', () => {
		expect(parseSessionCheckMessage(null)).toBeNull();
		expect(parseSessionCheckMessage(undefined)).toBeNull();
		expect(parseSessionCheckMessage(42)).toBeNull();
		expect(parseSessionCheckMessage({ status: 'changed' })).toBeNull();
	});

	it('rejects strings that are not one of the three defined statuses', () => {
		expect(parseSessionCheckMessage('CHANGED')).toBeNull();
		expect(parseSessionCheckMessage('')).toBeNull();
		expect(parseSessionCheckMessage('unrelated-message-from-something-else')).toBeNull();
	});
});
