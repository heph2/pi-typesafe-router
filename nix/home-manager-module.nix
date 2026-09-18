{ config, lib, ... }:

let
  cfg = config.programs.pi-typesafe-router;
  routeModels = {
    fast = "opencode/gpt-5-nano";
    balanced = "openai-codex/gpt-5.6-luna";
    deep = "opencode/gpt-6-astra";
  }
  // (if cfg.models == null then {} else cfg.models)
  // lib.optionalAttrs (cfg.fastModel != null) { fast = cfg.fastModel; }
  // lib.optionalAttrs (cfg.balancedModel != null) { balanced = cfg.balancedModel; }
  // lib.optionalAttrs (cfg.deepModel != null) { deep = cfg.deepModel; };
in
{
  options.programs.pi-typesafe-router = {
    enable = lib.mkEnableOption "the TypeSafe Pi model router";

    mode = lib.mkOption {
      type = lib.types.enum [ "off" "shadow" "live" ];
      default = "shadow";
      description = "Whether routing is disabled, logged only, or allowed to change models.";
    };

    models = lib.mkOption {
      type = lib.types.nullOr (lib.types.submodule {
        options = {
          fast = lib.mkOption {
            type = lib.types.str;
            default = "opencode/gpt-5-nano";
            description = "Model used for simple requests.";
          };
          balanced = lib.mkOption {
            type = lib.types.str;
            default = "openai-codex/gpt-5.6-luna";
            description = "Model used for normal coding requests.";
          };
          deep = lib.mkOption {
            type = lib.types.str;
            default = "opencode/gpt-6-astra";
            description = "Model used for complex or high-risk requests.";
          };
        };
      });
      default = null;
      example = {
        fast = "anthropic/claude-haiku";
        balanced = "openai/gpt-4.1";
        deep = "openai/o3";
      };
      description = "Provider/model targets for each routing tier.";
    };

    fastModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Legacy alias for models.fast.";
    };

    balancedModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Legacy alias for models.balanced.";
    };

    deepModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Legacy alias for models.deep.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.file.".pi/agent/extensions/typesafe-router/index.ts".source = ../src/index.ts;
    home.file.".pi/agent/extensions/typesafe-router/routing.ts".source = ../src/routing.ts;

    home.sessionVariables = {
      TYPESAFE_ROUTING = cfg.mode;
      TYPESAFE_ROUTE_MODELS = builtins.toJSON routeModels;
    };
  };
}
