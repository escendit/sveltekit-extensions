/**
 * Client-side (browser) implementation of the RP side of OpenID Connect Session
 * Management 1.0 (https://openid.net/specs/openid-connect-session-1_0.html).
 *
 * Polls the OP's check_session_iframe via postMessage on an interval, sending
 * `${clientId} ${sessionState}` and reading back "unchanged" | "changed" | "error".
 *
 * Does *not* need `document.domain` juggling despite the spec's note about it: that note
 * describes an older technique for same-origin DOM access across subdomains, whereas this
 * implementation only ever talks to the OP iframe via `postMessage`, which the HTML
 * standard defines to work across differing origins without any `document.domain`
 * involvement - the RP (app.example.com) and OP (auth.example.com) can be on different
 * subdomains and still exchange messages normally.
 */

type SessionCheckStatus = "unchanged" | "changed" | "error";

const SESSION_CHECK_STATUSES: ReadonlySet<string> = new Set([
    "unchanged",
    "changed",
    "error",
]);

/**
 * Parses a postMessage payload received from the OP's check_session_iframe. Returns
 * `null` for anything that isn't one of the three values the spec defines, so callers can
 * ignore unrelated messages landing on the same window instead of misinterpreting them.
 */
const parseSessionCheckMessage = (data: unknown): SessionCheckStatus | null => {
    if (typeof data === "string" && SESSION_CHECK_STATUSES.has(data)) {
        return data as SessionCheckStatus;
    }

    return null;
}

type SessionMonitorOptions = {
    /** The OP's discovered check_session_iframe URL (from the `/.oidc/session` endpoint). */
    checkSessionIframe: string;
    /** This RP's OIDC client_id. */
    clientId: string;
    /** The session_state issued alongside the current tokens. */
    sessionState: string;
    /** Poll interval in milliseconds. Defaults to 3000, within the spec's suggested range. */
    intervalMs?: number;
    /**
     * Called once when the OP reports the session state has changed - the user may have
     * signed out, signed in as someone else, or switched sessions in another tab/window.
     * Polling stops before this is called; the caller decides how to react (e.g. redirect
     * to `signout.endpoint` to clear the now-stale local session, or attempt a silent
     * `prompt=none` re-authentication if the app implements one).
     */
    onChanged: () => void;
    /**
     * Called once if the OP reports an error - per the spec this is non-retryable, so
     * polling stops before this is called rather than continuing to poll a broken check.
     */
    onError?: (data: unknown) => void;
};

type SessionMonitorHandle = {
    /** Starts the hidden iframe and polling loop. Safe to call once; a no-op if already started. */
    start(): void;
    /** Stops polling and removes the iframe. Safe to call even if never started. */
    stop(): void;
};

/**
 * Creates (but does not start) an RP-side session monitor for OpenID Connect Session
 * Management 1.0. Framework-agnostic - has no dependency on SvelteKit or this package's
 * server-side middleware beyond the shape of data `/.oidc/session` returns.
 */
const createSessionMonitor = (options: SessionMonitorOptions): SessionMonitorHandle => {
    const opOrigin = new URL(options.checkSessionIframe).origin;
    const intervalMs = options.intervalMs ?? 3000;
    const message = `${options.clientId} ${options.sessionState}`;

    let iframe: HTMLIFrameElement | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }

        window.removeEventListener("message", handleMessage);
        iframe?.remove();
        iframe = null;
    };

    const handleMessage = (event: MessageEvent) => {
        // Only ever trust messages that both came from the OP's own origin and were sent
        // by our own iframe - without both checks, any other frame on the page (or a
        // malicious one embedded in it) could spoof a "changed"/"error" status.
        if (event.origin !== opOrigin || event.source !== iframe?.contentWindow) {
            return;
        }

        const status = parseSessionCheckMessage(event.data);

        if (status === "changed") {
            stop();
            options.onChanged();
        } else if (status === "error") {
            stop();
            options.onError?.(event.data);
        }
        // "unchanged" (or anything unrecognized): keep polling.
    };

    const poll = () => {
        iframe?.contentWindow?.postMessage(message, opOrigin);
    };

    const start = () => {
        if (iframe !== null) {
            return;
        }

        iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.setAttribute("aria-hidden", "true");
        iframe.src = options.checkSessionIframe;

        window.addEventListener("message", handleMessage);

        iframe.addEventListener(
            "load",
            () => {
                poll();
                intervalId = setInterval(poll, intervalMs);
            },
            {once: true},
        );

        document.body.appendChild(iframe);
    };

    return {start, stop};
}

export {
    createSessionMonitor,
    parseSessionCheckMessage,
    type SessionMonitorOptions,
    type SessionMonitorHandle,
    type SessionCheckStatus,
};
