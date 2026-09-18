{ config, lib, ... }:

let
  cfg = config.programs.pi-typesafe-router;
in
{
  options.programs.pi-typesafe-router = {
    enable = lib.mkEnableOption "the TypeSafe Pi model router";

    mode = lib.mkOption {
      type = lib.types.enum [ "off" "shadow" "live" ];
      default = "shadow";
      description = "Whether routing is disabled, logged only, or allowed to change models.";
    };

    fastModel = lib.mkOption {
      type = lib.types.str;
      default = "opencode/gpt-5-nano";
    };

    balancedModel = lib.mkOption {
      type = lib.types.str;
      default = "openai-codex/gpt-5.6-luna";
    };

    deepModel = lib.mkOption {
      type = lib.types.str;
      default = "opencode/gpt-6-astra";
    };
  };

  config = lib.mkIf cfg.enable {
    home.file.".pi/agent/extensions/typesafe-router.ts".source = ../src/index.ts;

    home.sessionVariables = {
      TYPESAFE_ROUTING = cfg.mode;
      TYPESAFE_ROUTE_FAST = cfg.fastModel;
      TYPESAFE_ROUTE_BALANCED = cfg.balancedModel;
      TYPESAFE_ROUTE_DEEP = cfg.deepModel;
    };
  };
}
