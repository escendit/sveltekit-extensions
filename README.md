# sveltekit-extensions

A small monorepo of SvelteKit add‑ons maintained by Escendit. Each package lives under `packages/` with its own README, build, and release setup.

- Monorepo tooling: npm Workspaces + Lerna
- Runtime targets: Svelte 5 and SvelteKit 2 (see each package for details)

## Packages

- Session middleware: `@escendit/sveltekit-session`
  - README: [packages/session/README.md](packages/session/README.md)
- Auth (Keycloak): `@escendit/sveltekit-auth-keycloak`
  - README: [packages/auth/keycloak/README.md](packages/auth/keycloak/README.md)

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

For anything else (build, scripts, releasing), see the package READMEs. 
