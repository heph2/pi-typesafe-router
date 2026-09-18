{
  description = "TypeSafe model routing extension for Pi";

  outputs = { self }: {
    homeManagerModules.default = import ./nix/home-manager-module.nix;
  };
}
