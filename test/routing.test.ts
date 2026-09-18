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
