<script lang="ts">
	import { onMount } from 'svelte';
	import { createSessionMonitor, type SessionMonitorHandle } from '$lib/checkSession.js';

	type Props = {
		/** GET endpoint that returns the current session's Session Management data. */
		endpoint?: string;
		/** Poll interval in milliseconds, forwarded to createSessionMonitor (default 3000). */
		intervalMs?: number;
		/**
		 * Called once when Keycloak reports the session changed (signed out elsewhere,
		 * switched user, admin-revoked session, etc.). Defaults to redirecting to
		 * `/.oidc/signout`, which clears the now-stale local session - override this if the
		 * app wants different behavior (e.g. a silent `prompt=none` re-authentication).
		 */
		onchanged?: () => void;
		/** Called once if Keycloak's iframe reports an error - non-retryable per the spec. */
		onerror?: (data: unknown) => void;
	};

	let { endpoint = '/.oidc/session', intervalMs, onchanged, onerror }: Props = $props();

	onMount(() => {
		let cancelled = false;
		let monitor: SessionMonitorHandle | undefined;

		fetch(endpoint)
			.then((response) => response.json())
			.then((session) => {
				if (cancelled || !session.authenticated || !session.sessionManagementSupported) {
					return;
				}

				monitor = createSessionMonitor({
					checkSessionIframe: session.checkSessionIframe,
					clientId: session.clientId,
					sessionState: session.sessionState,
					intervalMs,
					onChanged: onchanged ?? (() => {
						window.location.href = '/.oidc/signout';
					}),
					onError: onerror
				});

				monitor.start();
			});

		return () => {
			cancelled = true;
			monitor?.stop();
		};
	});
</script>
