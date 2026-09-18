export type Route = "fast" | "balanced" | "deep";

export type ModelTarget = {
	provider: string;
	model: string;
};

export const ROUTES: Record<Route, ModelTarget> = {
	fast: { provider: "opencode", model: "gpt-5-nano" },
	balanced: { provider: "openai-codex", model: "gpt-5.6-luna" },
	deep: { provider: "opencode", model: "gpt-6-astra" },
};

export function chooseEffectiveRoute(
	requestedRoute: unknown,
	confidence: number,
	highRisk: number,
	confidenceThreshold = 0.75,
	riskThreshold = 0.8,
): Route {
	if (highRisk >= riskThreshold) return "deep";
	if (confidence < confidenceThreshold) return "balanced";
	if (requestedRoute === "fast" || requestedRoute === "deep") return requestedRoute;
	return "balanced";
}

export function routeTarget(route: Route, env: NodeJS.ProcessEnv = process.env): ModelTarget {
	const configured = env[`TYPESAFE_ROUTE_${route.toUpperCase()}`];
	if (!configured) return ROUTES[route];

	const separator = configured.indexOf("/");
	if (separator <= 0 || separator === configured.length - 1) return ROUTES[route];
	return {
		provider: configured.slice(0, separator),
		model: configured.slice(separator + 1),
	};
}
