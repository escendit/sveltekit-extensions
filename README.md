# sveltekit-extensions

A small monorepo of SvelteKit add‑ons maintained by Escendit. Each package lives under `packages/` with its own README, build, and release setup.

- Monorepo tooling: npm Workspaces + Lerna
- Runtime targets: Svelte 5 and SvelteKit 2 or 3-next (see each package for details)

## Packages

- Session middleware: `@escendit/sveltekit-session`
  - README: [packages/session/README.md](packages/session/README.md)
- Auth (Keycloak): `@escendit/sveltekit-auth-keycloak`
  - README: [packages/auth/keycloak/README.md](packages/auth/keycloak/README.md)
  - OIDC Authorization Code + PKCE, transparent token refresh, RP-Initiated Logout, client-side Session Management 1.0, and server-side Back-Channel Logout 1.0

## Quick usage

Install the package you need in your SvelteKit app (example):

```sh
npm i @escendit/sveltekit-session
```

Then follow the corresponding package README for setup and APIs.

## Repo layout

- `packages/…` — individual publishable packages
- `packages/auth/keycloak` — Keycloak integration for SvelteKit auth
- `packages/session` — session middleware + stores (in‑memory, Redis)

## Releasing

Pushing a GitHub Release triggers the `Release` workflow (build), which on success fans out to `npm` and `GitHub` workflows that version and publish every non-private package via `lerna publish from-package`.

- **npm** (`registry.npmjs.org`): authenticated via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC) - the workflow requests a short-lived GitHub Actions identity token instead of using a stored `NPM_TOKEN` secret. Lerna (v9+) has this built in; no extra config is needed in the workflow beyond the `id-token: write` permission. Each published package must be configured with this repo's `npm-registry.yml` workflow as its Trusted Publisher in that package's Settings on npmjs.com before its first OIDC-authenticated release.
- **GitHub Packages** (`npm.pkg.github.com`): authenticated via the workflow's own `GITHUB_TOKEN`, scoped to this repository.

For anything else (build, scripts), see the package READMEs.
