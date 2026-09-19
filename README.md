# pi-typesafe-router

<p align="center">
  <img src="pi-typesafe-router-logo.png" alt="pi-typesafe-router logo" width="240">
</p>

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

Routing is phase-aware: design and review use the `deep` route, while implementation
and debugging use `balanced`. The phase is kept in the session and the active model
changes only after a confident phase transition, so implementation turns can reuse
their own prompt cache without pinning one model for the whole chat. A high-risk
classification can still escalate to `deep`; that escalation stays in effect until
the next phase transition.

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

# Choose a target for every route (provider/model)
export TYPESAFE_ROUTE_MODELS='{"fast":"anthropic/claude-haiku","balanced":"openai/gpt-4.1","deep":"openai/o3"}'
```

The map can also be configured one route at a time with `TYPESAFE_ROUTE_FAST`,
`TYPESAFE_ROUTE_BALANCED`, and `TYPESAFE_ROUTE_DEEP`; those variables override
matching entries in `TYPESAFE_ROUTE_MODELS`.

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
    models = {
      fast = "opencode/gpt-5-nano";
      balanced = "openai-codex/gpt-5.6-luna";
      deep = "opencode/gpt-6-astra";
    };
  };
}
```

`models.fast`, `models.balanced`, and `models.deep` accept `provider/model`
targets. The older `fastModel`, `balancedModel`, and `deepModel` options remain
available as per-route compatibility aliases; if both forms are set, the legacy
alias wins for that route.

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
| `TYPESAFE_ROUTE_MODELS` | built-in route map | JSON map of `fast`, `balanced`, and `deep` targets |
| `TYPESAFE_ROUTE_FAST` | `opencode/gpt-5-nano` | Fast target; overrides the map |
| `TYPESAFE_ROUTE_BALANCED` | `openai-codex/gpt-5.6-luna` | Balanced target; overrides the map |
| `TYPESAFE_ROUTE_DEEP` | `opencode/gpt-6-astra` | Deep target; overrides the map |
| `TYPESAFE_CONFIDENCE_THRESHOLD` | `0.75` | Below this, use balanced when no phase is established |
| `TYPESAFE_PHASE_TRANSITION_THRESHOLD` | `0.8` | Confidence required to change coding phase |
| `TYPESAFE_RISK_THRESHOLD` | `0.8` | At or above this, use deep |
| `TYPESAFE_ROUTING_TIMEOUT_MS` | `2500` | TypeSafe request timeout |
| `TYPESAFE_MAX_PROMPT_CHARS` | `12000` | Prompt sent to TypeSafe |
| `TYPESAFE_API_URL` | TypeSafe System One endpoint | API endpoint override |
| `TYPESAFE_MODEL` | `jev-latest` | TypeSafe model alias |
| `TYPESAFE_LOG_PATH` | `~/.pi/agent/state/typesafe-router.jsonl` | Decision log |
| `TYPESAFE_LOG_PROMPTS` | unset | Set to `1` to log full prompts; otherwise only a hash is logged |

The prompt, truncated to `TYPESAFE_MAX_PROMPT_CHARS`, is sent to TypeSafe for classification. Treat this as an external service boundary and avoid sending sensitive material when that is not acceptable.

## Measuring routing cost

The decision log records the phase, transition, target model, and TypeSafe usage.
After each model response, it also records a `model_usage` entry with provider-reported
input, output, cache-read, cache-write, and cost values:

```bash
jq 'select(.log_type == "model_usage") |
  {timestamp, phase, model, model_switched, input_tokens, cache_read_tokens, cost}' \
  ~/.pi/agent/state/typesafe-router.jsonl
```

Aggregate actual provider cost and cache behavior with:

```bash
jq -s 'map(select(.log_type == "model_usage")) |
  {turns: length,
   switches: (map(select(.model_switched)) | length),
   cost: (map(.cost.total // 0) | add // 0),
   input_tokens: (map(.input_tokens) | add // 0),
   cache_read_tokens: (map(.cache_read_tokens) | add // 0)}' \
  ~/.pi/agent/state/typesafe-router.jsonl
```

Compare representative tasks with routing in `shadow` mode and `live` mode using
separate `TYPESAFE_LOG_PATH` files. The important quantities are the cheaper model's
steady-state cost versus the one-time cache refill when a phase transition occurs.
The `cost` field is the provider-reported Pi model cost; TypeSafe classification
usage is logged separately and should be added if that API is billed.

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
