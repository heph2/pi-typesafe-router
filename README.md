# pi-typesafe-router

A [Pi](https://pi.dev) extension that uses [TypeSafe](https://typesafe.ai)'s Jev model to choose a model route before each agent turn.

```text
user prompt → TypeSafe judgment → route/confidence/risk → optional pi.setModel()
```

## Default routes

| Route | Model | Use |
|---|---|---|
| `fast` | `opencode/gpt-5-nano` | Simple questions and tiny edits |
| `balanced` | `openai-codex/gpt-5.6-luna` | Normal coding and focused debugging |
| `deep` | `opencode/gpt-6-astra` | Complex architecture, multi-file work, and high uncertainty |

The fast route uses a paid OpenCode Zen model. OpenCode free-tier models are restricted to the OpenCode application and cannot be used through the API.

## Modes

- `off`: do nothing.
- `shadow`: classify and log, but never change the active model. This is the default.
- `live`: classify and call `pi.setModel()` when the result is usable.

TypeSafe failures, unavailable models, and logging failures never fail the agent turn. Low-confidence results fall back to `balanced`; high-risk work goes to `deep`.

## Plain Pi installation

Requirements: Pi with extension support, Node.js 22.6+ for development tests, and a TypeSafe API key.

Install from a local checkout:

```bash
pi install ~/code/pi-typesafe-router
```

Or install a published Git repository:

```bash
pi install git:github.com/YOUR_USER/pi-typesafe-router@main
```

Set the key in the shell that starts Pi. Do not commit it or put it in a Nix expression:

```bash
export TYPESAFE_API_KEY="$(cat ~/.config/typesafe/api-key)"
export TYPESAFE_ROUTING=shadow
```

Start Pi normally:

```bash
pi
```

After reviewing shadow decisions, enable switching for a session:

```bash
TYPESAFE_ROUTING=live pi
```

For a one-off checkout test without installing it:

```bash
TYPESAFE_ROUTING=shadow \
  pi --no-session -e ~/code/pi-typesafe-router/src/index.ts \
  'Add a focused validation check to this Nix function.'
```

## Nix/Home Manager installation

The repository exposes `homeManagerModules.default`.

Add the repository as a flake input:

```nix
# flake.nix
inputs.pi-typesafe-router.url = "github:YOUR_USER/pi-typesafe-router";
```

For local development instead:

```nix
inputs.pi-typesafe-router.url = "path:/home/heph/code/pi-typesafe-router";
```

Import and configure the module in Home Manager:

```nix
# home.nix
{ inputs, ... }:
{
  imports = [ inputs.pi-typesafe-router.homeManagerModules.default ];

  programs.pi-typesafe-router = {
    enable = true;
    mode = "shadow";
    fastModel = "opencode/gpt-5-nano";
    balancedModel = "openai-codex/gpt-5.6-luna";
    deepModel = "opencode/gpt-6-astra";
  };
}
```

The module installs the extension at:

```text
~/.pi/agent/extensions/typesafe-router/index.ts
```

It deliberately does not provision `TYPESAFE_API_KEY`. Use agenix, sops, a password manager, or another runtime secret mechanism. For example, with an agenix file already materialized at `~/.config/typesafe/api-key`:

```nix
programs.zsh.initContent = lib.mkAfter ''
  if [[ -r "$HOME/.config/typesafe/api-key" ]]; then
    export TYPESAFE_API_KEY="$(<"$HOME/.config/typesafe/api-key")"
  fi
'';
```

Then activate Home Manager and start a new shell. Keep the module in `shadow` mode until its decisions look good:

```bash
TYPESAFE_ROUTING=live pi
```

## Configuration

All settings are environment variables. Model values use `provider/model`.

| Variable | Default | Description |
|---|---|---|
| `TYPESAFE_API_KEY` | unset | Required API key |
| `TYPESAFE_ROUTING` | `shadow` | `off`, `shadow`, or `live` |
| `TYPESAFE_ROUTE_FAST` | `opencode/gpt-5-nano` | Fast target |
| `TYPESAFE_ROUTE_BALANCED` | `openai-codex/gpt-5.6-luna` | Balanced target |
| `TYPESAFE_ROUTE_DEEP` | `opencode/gpt-6-astra` | Deep target |
| `TYPESAFE_CONFIDENCE_THRESHOLD` | `0.75` | Below this, use balanced |
| `TYPESAFE_RISK_THRESHOLD` | `0.8` | At or above this, use deep |
| `TYPESAFE_ROUTING_TIMEOUT_MS` | `2500` | TypeSafe request timeout |
| `TYPESAFE_MAX_PROMPT_CHARS` | `12000` | Prompt sent to TypeSafe |
| `TYPESAFE_API_URL` | TypeSafe System One endpoint | API endpoint override |
| `TYPESAFE_MODEL` | `jev-latest` | TypeSafe model alias |
| `TYPESAFE_LOG_PATH` | `~/.pi/agent/state/typesafe-router.jsonl` | Decision log |
| `TYPESAFE_LOG_PROMPTS` | unset | Set to `1` to log full prompts; otherwise only a hash is logged |

The prompt, truncated to `TYPESAFE_MAX_PROMPT_CHARS`, is sent to TypeSafe for classification. Treat this as an external service boundary and avoid sending sensitive material when that is not acceptable.

## Inspecting decisions

```bash
jq '{route, target_model, confidence, complexity, high_risk, latency_ms, error}' \
  ~/.pi/agent/state/typesafe-router.jsonl
```

## Development

```bash
npm test
nix flake check
```

The extension is loaded as TypeScript by Pi; no build step is required.
