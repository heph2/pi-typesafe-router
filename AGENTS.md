# AGENTS.md

## Project purpose

`pi-typesafe-router` is a Pi extension that asks TypeSafe/Jev to classify each new agent turn and optionally selects a Pi model.

## Source of truth

- Extension: `src/index.ts`
- Routing policy: `src/routing.ts`
- Tests: `test/`
- Home Manager module: `nix/home-manager-module.nix`
- User-facing setup: `README.md`

Do not commit API keys, `auth.json`, prompt logs, or generated Nix store paths.

## Development

Run the focused tests with:

```bash
npm test
```

The extension is TypeScript loaded directly by Pi; do not add a build step unless Pi's extension loader requires one.

## Behavior contract

- `shadow` is the safe default and must not change the active model.
- `live` may call `pi.setModel()` only after a successful TypeSafe response.
- TypeSafe/API/logging failures must never fail or block the user's agent turn.
- Low-confidence classifications fall back to `balanced`; high-risk work escalates to `deep`.
- Secrets stay in environment variables or an external secret manager, never in Nix expressions or repository files.

## Nix

Keep the Home Manager module self-contained and preserve the non-Nix installation path. Validate with:

```bash
nix flake check
```
