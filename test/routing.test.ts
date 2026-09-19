import assert from "node:assert/strict";
import test from "node:test";
import {
	ROUTES,
	chooseEffectivePhase,
	choosePhaseAwareRoute,
	chooseEffectiveRoute,
	shouldApplyModelChange,
	routeForPhase,
	routeTarget,
} from "../src/routing.ts";

test("maps coding phases to routes", () => {
	assert.equal(routeForPhase("design"), "deep");
	assert.equal(routeForPhase("implementation"), "balanced");
	assert.equal(routeForPhase("review"), "deep");
	assert.equal(routeForPhase("debugging"), "balanced");
});

test("accepts a confident phase transition", () => {
	assert.equal(chooseEffectivePhase("implementation", 0.85, "design"), "implementation");
});

test("keeps the current phase when the new phase is uncertain", () => {
	assert.equal(chooseEffectivePhase("implementation", 0.74, "design"), "design");
	assert.equal(chooseEffectivePhase("other", 0.99, "design"), "design");
});

test("uses a confident initial phase", () => {
	assert.equal(chooseEffectivePhase("design", 0.85), "design");
	assert.equal(chooseEffectivePhase("other", 0.99), undefined);
});

test("routes design and implementation phases without switching on uncertainty", () => {
	assert.deepEqual(
		choosePhaseAwareRoute("design", 0.9, undefined, "balanced", 0.9, 0),
		{ phase: "design", route: "deep", phaseTransition: true },
	);
	assert.deepEqual(
		choosePhaseAwareRoute("implementation", 0.7, "design", "balanced", 0.9, 0),
		{ phase: "design", route: "deep", phaseTransition: false },
	);
	assert.deepEqual(
		choosePhaseAwareRoute("implementation", 0.9, "design", "deep", 0.9, 0),
		{ phase: "implementation", route: "balanced", phaseTransition: true },
	);
});

test("still escalates a risky implementation phase", () => {
	assert.deepEqual(
		choosePhaseAwareRoute("implementation", 0.9, "design", "balanced", 0.9, 0.8),
		{ phase: "implementation", route: "deep", phaseTransition: true },
	);
});

test("only changes models at phase transitions or high-risk escalation", () => {
	assert.equal(shouldApplyModelChange("provider/a", "provider/b", false, "balanced", 0), false);
	assert.equal(shouldApplyModelChange("provider/a", "provider/b", true, "balanced", 0), true);
	assert.equal(shouldApplyModelChange("provider/a", "provider/b", false, "deep", 0.8), true);
	assert.equal(shouldApplyModelChange("provider/a", "provider/b", false, "balanced", 0, 0.8, true), true);
	assert.equal(shouldApplyModelChange("provider/a", "provider/a", true, "deep", 1), false);
});

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
