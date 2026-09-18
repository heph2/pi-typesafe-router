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

function parseModelTarget(value: unknown): ModelTarget | undefined {
	if (typeof value !== "string") return undefined;
	const separator = value.indexOf("/");
	if (separator <= 0 || separator === value.length - 1) return undefined;
	return {
		provider: value.slice(0, separator),
		model: value.slice(separator + 1),
	};
}

function configuredRouteModels(env: NodeJS.ProcessEnv): Partial<Record<Route, ModelTarget>> {
	const raw = env.TYPESAFE_ROUTE_MODELS;
	if (!raw) return {};

	try {
		const values = JSON.parse(raw) as Record<string, unknown>;
		return {
			fast: parseModelTarget(values.fast),
			balanced: parseModelTarget(values.balanced),
			deep: parseModelTarget(values.deep),
		};
	} catch {
		return {};
	}
}

export function routeTarget(route: Route, env: NodeJS.ProcessEnv = process.env): ModelTarget {
	const configured = parseModelTarget(env[`TYPESAFE_ROUTE_${route.toUpperCase()}`])
		?? configuredRouteModels(env)[route];
	return configured ?? ROUTES[route];
}
