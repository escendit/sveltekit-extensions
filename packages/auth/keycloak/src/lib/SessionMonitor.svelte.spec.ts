import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SessionMonitor from './SessionMonitor.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
	document.querySelectorAll('iframe').forEach((iframe) => iframe.remove());
});

describe('SessionMonitor.svelte', () => {
	it('does not create a check-session iframe when the session endpoint reports no Session Management support', async () => {
		const fetchMock = vi.fn(async () => ({
			json: async () => ({ authenticated: true, sessionManagementSupported: false })
		}));
		vi.stubGlobal('fetch', fetchMock);

		render(SessionMonitor, { props: { endpoint: '/.oidc/session' } });

		// Let the mounted component's fetch().then(...) chain settle.
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(fetchMock).toHaveBeenCalledWith('/.oidc/session');
		expect(document.querySelector('iframe')).toBeNull();
	});

	it('does not create a check-session iframe when unauthenticated', async () => {
		const fetchMock = vi.fn(async () => ({
			json: async () => ({ authenticated: false })
		}));
		vi.stubGlobal('fetch', fetchMock);

		render(SessionMonitor, { props: {} });

		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.querySelector('iframe')).toBeNull();
	});

	it('creates a hidden check-session iframe pointed at the discovered checkSessionIframe when supported', async () => {
		const fetchMock = vi.fn(async () => ({
			json: async () => ({
				authenticated: true,
				sessionManagementSupported: true,
				clientId: 'my-client',
				sessionState: 'session-state-1',
				checkSessionIframe: 'https://idp.example.com/realms/test/check-session'
			})
		}));
		vi.stubGlobal('fetch', fetchMock);

		render(SessionMonitor, { props: {} });

		await new Promise((resolve) => setTimeout(resolve, 0));

		const iframe = document.querySelector('iframe');
		expect(iframe).not.toBeNull();
		expect(iframe?.src).toBe('https://idp.example.com/realms/test/check-session');
		expect(iframe?.style.display).toBe('none');
	});
});
