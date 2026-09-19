export type Route = "fast" | "balanced" | "deep";
export type Phase = "design" | "implementation" | "review" | "debugging";

export type ModelTarget = {
	provider: string;
	model: string;
};

export const ROUTES: Record<Route, ModelTarget> = {
	fast: { provider: "opencode", model: "gpt-5-nano" },
	balanced: { provider: "openai-codex", model: "gpt-5.6-luna" },
	deep: { provider: "opencode", model: "gpt-6-astra" },
};

const PHASES: readonly Phase[] = ["design", "implementation", "review", "debugging"];

export function isPhase(value: unknown): value is Phase {
	return typeof value === "string" && PHASES.includes(value as Phase);
}

function parsePhase(value: unknown): Phase | undefined {
	return isPhase(value) ? value : undefined;
}

export function chooseEffectivePhase(
	requestedPhase: unknown,
	confidence: number,
	currentPhase?: Phase,
	transitionThreshold = 0.8,
): Phase | undefined {
	const phase = parsePhase(requestedPhase);
	if (!phase || (currentPhase && phase !== currentPhase && confidence < transitionThreshold)) return currentPhase;
	return phase;
}

export function routeForPhase(phase: Phase): Route {
	return phase === "design" || phase === "review" ? "deep" : "balanced";
}

export type PhaseRouteDecision = {
	phase: Phase | undefined;
	route: Route;
	phaseTransition: boolean;
};

export function shouldApplyModelChange(
	currentModel: string | null,
	targetModel: string,
	phaseTransition: boolean,
	route: Route,
	highRisk: number,
	riskThreshold = 0.8,
	initialDecision = false,
): boolean {
	if (currentModel === targetModel) return false;
	return initialDecision || phaseTransition || (route === "deep" && highRisk >= riskThreshold);
}

export function choosePhaseAwareRoute(
	requestedPhase: unknown,
	phaseConfidence: number,
	currentPhase: Phase | undefined,
	requestedRoute: unknown,
	routeConfidence: number,
	highRisk: number,
	phaseTransitionThreshold = 0.8,
	confidenceThreshold = 0.75,
	riskThreshold = 0.8,
): PhaseRouteDecision {
	const phase = chooseEffectivePhase(requestedPhase, phaseConfidence, currentPhase, phaseTransitionThreshold);
	const phaseTransition = phase !== undefined && phase !== currentPhase;
	const route = phase
		? highRisk >= riskThreshold
			? "deep"
			: routeForPhase(phase)
		: chooseEffectiveRoute(requestedRoute, routeConfidence, highRisk, confidenceThreshold, riskThreshold);
	return { phase, route, phaseTransition };
}

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
