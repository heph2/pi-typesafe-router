import assert from "node:assert/strict";
import test from "node:test";
import { ROUTES, chooseEffectiveRoute, routeTarget } from "../src/routing.ts";

test("uses the requested route when confidence is sufficient", () => {
	assert.equal(chooseEffectiveRoute("fast", 0.9, 0.1), "fast");
	assert.equal(chooseEffectiveRoute("deep", 0.9, 0.1), "deep");
});

test("falls back to balanced for uncertain classifications", () => {
	assert.equal(chooseEffectiveRoute("deep", 0.74, 0), "balanced");
});

test("escalates high-risk work to the deep route", () => {
	assert.equal(chooseEffectiveRoute("fast", 0.99, 0.8), "deep");
});

test("keeps the configured default route targets", () => {
	assert.deepEqual(routeTarget("fast"), ROUTES.fast);
	assert.deepEqual(routeTarget("balanced"), ROUTES.balanced);
	assert.deepEqual(routeTarget("deep"), ROUTES.deep);
});

test("reads a route model map for non-Nix configuration", () => {
	const env = {
		TYPESAFE_ROUTE_MODELS: JSON.stringify({
			fast: "anthropic/claude-haiku",
			balanced: "openai/gpt-4.1",
			deep: "openai/o3",
		}),
	};

	assert.deepEqual(routeTarget("fast", env), { provider: "anthropic", model: "claude-haiku" });
	assert.deepEqual(routeTarget("balanced", env), { provider: "openai", model: "gpt-4.1" });
	assert.deepEqual(routeTarget("deep", env), { provider: "openai", model: "o3" });
});

test("prefers a route-specific environment variable over the route model map", () => {
	const env = {
		TYPESAFE_ROUTE_MODELS: JSON.stringify({ fast: "anthropic/claude-haiku" }),
		TYPESAFE_ROUTE_FAST: "openai/gpt-4.1-mini",
	};

	assert.deepEqual(routeTarget("fast", env), { provider: "openai", model: "gpt-4.1-mini" });
});

test("ignores malformed route model configuration", () => {
	assert.deepEqual(routeTarget("fast", { TYPESAFE_ROUTE_MODELS: "not-json" }), ROUTES.fast);
	assert.deepEqual(
		routeTarget("fast", { TYPESAFE_ROUTE_MODELS: JSON.stringify({ fast: "missing-provider" }) }),
		ROUTES.fast,
	);
});
