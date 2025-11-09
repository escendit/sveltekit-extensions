# @escendit/sveltekit-session

Lightweight session middleware for SvelteKit. It issues and persists a secure session ID, stores minimal session data in a pluggable store, and exposes the session on `event.locals`.

Works out of the box with an in‑memory store for development, and includes a Redis store for production when running on Bun.

## Features

- Simple `SessionMiddleware` you add to `hooks.server.ts`
- Pluggable session storage via `ISessionStore` (in‑memory and Redis implementations included)
- Secure cookie with `httpOnly`, `secure`, `sameSite: 'strict'`, `priority: 'high'`
- Session ID generation using Node crypto and base58 encoding by default
- Sensible defaults with runtime validation
- Explicit behavior for first request and mutation safety

## Installation

```sh
npm i @escendit/sveltekit-session
# or
pnpm add @escendit/sveltekit-session
# or
bun add @escendit/sveltekit-session
```

Peer dependencies:
- `svelte@^5`
- `@sveltejs/kit@^2` (app peer, used by you)

Notes:
- The default in‑memory store works everywhere (Node/Bun) and is great for local development.
- The provided `RedisSessionStore` uses Bun's built‑in Redis client. If you want Redis, run your app with Bun.

## Quick start

Add the middleware to your `src/hooks.server.ts`:

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { SessionMiddleware } from '@escendit/sveltekit-session';

export const handle: Handle = sequence(
  SessionMiddleware({
    cookie: 'session.id',
    expireIn: 60 * 60 * 24 // 1 day (seconds)
  })
);
```

Access the session in your endpoints or load functions via `event.locals`:

```ts
// src/routes/+page.server.ts
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  // Available on locals:
  // - locals.store: ISessionStore
  // - locals.hasher: ISessionHasher
  // - locals.generator: ISessionGenerator
  // - locals.sessionId: string (present once a session exists)
  // - locals.session: { identity: unknown | null; created: string | null }
  return {
    sessionId: locals.sessionId,
    session: locals.session
  };
};
```

Locals interface (for reference):

```ts
// src/app.d.ts
import type { ISessionGenerator, ISessionHasher, ISessionStore } from '@escendit/sveltekit-session';

declare global {
  namespace App {
    interface Locals {
      store: ISessionStore;
      hasher: ISessionHasher;
      generator: ISessionGenerator;
      sessionId: string;
      session: any;
    }
  }
}
export {};
```

## How it works

- On each request the middleware checks for the configured session cookie.
- If a valid session exists in the store, it populates:
  - `event.locals.sessionId`
  - `event.locals.session = { identity: any | null, created: string | null }`
  - Always available: `event.locals.store`, `event.locals.hasher`, `event.locals.generator` (from middleware config)
- If there is no valid session yet:
  - It generates a new random ID, stores minimal fields (`identity=null`, `created=timestamp`) and sets an expiry on the store entry.
  - It sets a secure cookie and `Cache-Control: no-store` header.
  - For `GET` requests, it performs a `303` redirect to the same URL so the browser will include the cookie on the next request.
  - For non‑`GET` requests without an existing session, it returns `405` to ensure the client establishes a session via `GET` first.

## Configuration

All options are optional; the following are the defaults applied internally:

- `cookie`: `"session.id"`
- `expireIn`: `86400` (seconds)
- `size`: `128` (entropy bytes for ID generation)
- `sessionStore`: `new InMemorySessionStore()`
- `sessionHasher`: `new DefaultSessionHasher()` (encodes to base58)
- `sessionGenerator`: `new DefaultSessionGenerator()` (uses `crypto.randomBytes`)

Example with custom options:

```ts
import { SessionMiddleware, InMemorySessionStore } from '@escendit/sveltekit-session';

export const handle = sequence(
  SessionMiddleware({
    cookie: 'sid',
    expireIn: 60 * 10, // 10 minutes
    size: 256,
    sessionStore: new InMemorySessionStore()
  })
);
```

## Setting identity or other session fields

This library keeps the session store minimal by design. If you want to associate an identity (e.g., after login), create and reuse the same store instance you pass into the middleware.

```ts
// src/lib/session-store.ts
import { InMemorySessionStore } from '@escendit/sveltekit-session';
export const sessionStore = new InMemorySessionStore();
```

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { SessionMiddleware } from '@escendit/sveltekit-session';
import { sessionStore } from '$lib/session-store';

export const handle = sequence(
  SessionMiddleware({ sessionStore })
);
```

```ts
// src/routes/login/+page.server.ts (example)
import type { Actions } from './$types';
import { sessionStore } from '$lib/session-store';

export const actions: Actions = {
  default: async ({ locals }) => {
    const sessionKey = `session:${locals.sessionId}`;
    await sessionStore.setMultiple(sessionKey, [
      'identity', JSON.stringify({ userId: '123', roles: ['user'] })
    ]);
    // Optionally refresh TTL
    // await sessionStore.expire(sessionKey, 60 * 60 * 24);
    return { success: true };
  }
};
```

The middleware will deserialize the `identity` JSON on subsequent requests and expose it on `locals.session.identity`.

## Using Redis (Bun runtime)

The package includes a Redis store that uses Bun's built‑in Redis client.

```ts
// src/lib/session-store.ts
import { RedisSessionStore } from '@escendit/sveltekit-session';
export const sessionStore = new RedisSessionStore();
```

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { SessionMiddleware } from '@escendit/sveltekit-session';
import { sessionStore } from '$lib/session-store';

export const handle = sequence(
  SessionMiddleware({ sessionStore, cookie: 'sid', expireIn: 60 * 60 })
);
```

Requirements:
- Run your SvelteKit server with Bun (`bun run dev` / `bun run start`).
- Ensure your Redis instance is reachable per Bun's configuration. See Bun docs for `bun:redis`.

## API

Package exports:
- `SessionMiddleware(sessionConfig?: SessionConfig): Handle`
- `type SessionConfig` — public configuration shape
- `type ISessionStore` — storage interface with `exists`, `expire`, `getSingle`, `setSingle`, `getMultiple`, `setMultiple`
- `type ISessionHasher` — `hash(buffer: Uint8Array): string`
- `type ISessionGenerator` — `generate(size: number): Uint8Array`
- `InMemorySessionStore` — default dev store
- `RedisSessionStore` — Bun Redis store
- `DefaultSessionGenerator` — uses Node `crypto.randomBytes`
- `DefaultSessionHasher` — base58 encoding

## Scripts

Common scripts from `package.json`:
- `dev` — start vite dev server (Bun)
- `build` — build library and package
- `preview` — preview built app
- `check` / `check:watch` — typecheck with `svelte-check`
- `format` / `lint` — Prettier
- `test` — run unit tests (Vitest)

## Notes

- Cookies are set with `secure: true`; when testing locally on `http://localhost`, ensure your browser still handles the cookie as expected or use HTTPS.
- First request sets the session; non‑GET requests before a session is established will receive `405`.
- The library sets `Cache-Control: no-store` on session‑issuing responses to avoid caching issues.

## License

Licensed under the Apache License, Version 2.0. See the `LICENSE` file for the full text.

Copyright (c) 2025 Escendit.
