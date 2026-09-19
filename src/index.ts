import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	choosePhaseAwareRoute,
	isPhase,
	routeTarget,
	shouldApplyModelChange,
	type Phase,
	type Route,
} from "./routing.ts";

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_LOG_PATH = join(homedir(), ".pi", "agent", "state", "typesafe-router.jsonl");
const PHASE_STATE_ENTRY = "typesafe-router-phase";

type TypeSafeResponse = {
	answers?: {
		phase?: { choice?: string; confidence?: number; probabilities?: Record<string, number> };
		route?: { choice?: string; confidence?: number; probabilities?: Record<string, number> };
		complexity?: { score?: number; confidence?: number };
		high_risk?: { noul?: number };
	};
	usage?: Record<string, number>;
};

function numberEnv(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function currentModel(ctx: Pick<ExtensionContext, "model">): string | null {
	return ctx.model?.provider && ctx.model.id ? `${ctx.model.provider}/${ctx.model.id}` : null;
}

function notify(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message: string, level: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function promptForLog(prompt: string): string | undefined {
	if (process.env.TYPESAFE_LOG_PROMPTS === "1") return prompt;
	return undefined;
}

function promptHash(prompt: string): string {
	return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function restorePhase(entries: Iterable<unknown>): Phase | undefined {
	let phase: Phase | undefined;
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== PHASE_STATE_ENTRY) continue;
		const data = candidate.data;
		if (data && typeof data === "object" && isPhase((data as { phase?: unknown }).phase)) {
			phase = (data as { phase: Phase }).phase;
		}
	}
	return phase;
}

async function writeLog(entry: Record<string, unknown>) {
	const path = process.env.TYPESAFE_LOG_PATH || DEFAULT_LOG_PATH;
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(entry)}\n`);
}

async function writeLogSafely(entry: Record<string, unknown>) {
	try {
		await writeLog(entry);
	} catch {
		// Routing must never fail a user turn because logging is unavailable.
	}
}

export default function (pi: ExtensionAPI) {
	let currentPhase: Phase | undefined;
	let lastObservedModel: string | null = null;
	let activeDecision: {
		prompt_hash: string;
		phase?: Phase;
		route: Route;
		phase_transition: boolean;
		current_model: string | null;
		target_model: string;
	} | undefined;

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		currentPhase = undefined;
		lastObservedModel = null;
		activeDecision = undefined;
		const branch = ctx.sessionManager.getBranch();
		currentPhase = restorePhase(branch);
		for (const entry of branch) {
			if (!entry || entry.type !== "message" || entry.message.role !== "assistant") continue;
			lastObservedModel = `${entry.message.provider}/${entry.message.model}`;
		}
	});

	pi.on("agent_end", async (event) => {
		for (const message of event.messages) {
			if (message.role !== "assistant") continue;
			const modelName = `${message.provider}/${message.model}`;
			const switched = lastObservedModel !== null && lastObservedModel !== modelName;
			await writeLogSafely({
				log_type: "model_usage",
				timestamp: new Date(message.timestamp).toISOString(),
				prompt_hash: activeDecision?.prompt_hash ?? null,
				phase: activeDecision?.phase ?? currentPhase ?? null,
				route: activeDecision?.route ?? null,
				phase_transition: activeDecision?.phase_transition ?? false,
				current_model: activeDecision?.current_model ?? null,
				target_model: activeDecision?.target_model ?? null,
				model: modelName,
				model_switched: switched,
				input_tokens: message.usage.input,
				output_tokens: message.usage.output,
				cache_read_tokens: message.usage.cacheRead,
				cache_write_tokens: message.usage.cacheWrite,
				cost: message.usage.cost,
			});
			lastObservedModel = modelName;
		}
		activeDecision = undefined;
	});

	pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
		activeDecision = undefined;
		const mode = process.env.TYPESAFE_ROUTING ?? "shadow";
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (mode === "off" || !apiKey || !event.prompt.trim()) return;

		const started = Date.now();
		const prompt = event.prompt.slice(0, numberEnv("TYPESAFE_MAX_PROMPT_CHARS", 12000));
		const model = currentModel(ctx);
		if (lastObservedModel === null) lastObservedModel = model;
		activeDecision = undefined;
		const baseLog = {
			timestamp: new Date().toISOString(),
			prompt_hash: promptHash(event.prompt),
			prompt: promptForLog(event.prompt),
			mode,
			current_model: model,
		};

		try {
			const response = await fetch(process.env.TYPESAFE_API_URL || DEFAULT_ENDPOINT, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				signal: AbortSignal.timeout(numberEnv("TYPESAFE_ROUTING_TIMEOUT_MS", 2500)),
				body: JSON.stringify({
					model: process.env.TYPESAFE_MODEL || "jev-latest",
					state: { prompt, cwd: ctx.cwd, current_model: model, current_phase: currentPhase ?? null },
					questions: {
						phase: {
							type: "choice",
							instructions: "What coding phase is the user's current request part of? Classify the immediate work, not the overall project.",
							criteria: {
								design: "Architecture, requirements, API design, planning, tradeoffs, or deciding how the change should work before implementation",
								implementation: "Writing or editing code, configuration, tests, or documentation to carry out an agreed design",
								review: "Reviewing completed or proposed work for correctness, quality, security, or maintainability",
								debugging: "Diagnosing or fixing a failing test, runtime error, regression, or unexpected behavior",
								other: "A request that does not clearly belong to a coding phase above",
							},
						},
						route: {
							type: "choice",
							instructions: "Which model route best fits this request?",
							criteria: {
								fast: "Simple questions, explanations, lookups, or very small edits",
								balanced: "Normal coding tasks or focused debugging",
								deep: "Complex architecture, multi-file changes, difficult debugging, or high uncertainty",
							},
						},
						complexity: {
							type: "score",
							instructions: "How complex is this request?",
							criteria: ["Trivial", "Moderate", "Complex", "Very complex"],
						},
						high_risk: {
							type: "noul",
							instructions: "Could choosing the wrong response cause destructive changes, data loss, or a security problem?",
						},
					},
				}),
			});

			if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
			const result = (await response.json()) as TypeSafeResponse;
			const answers = result.answers ?? {};
			const confidence = answers.route?.confidence ?? 0;
			const phaseConfidence = answers.phase?.confidence ?? 0;
			const highRisk = answers.high_risk?.noul ?? 0;
			const initialDecision = currentPhase === undefined;
			const decision = choosePhaseAwareRoute(
				answers.phase?.choice,
				phaseConfidence,
				currentPhase,
				answers.route?.choice,
				confidence,
				highRisk,
				numberEnv("TYPESAFE_PHASE_TRANSITION_THRESHOLD", 0.8),
				numberEnv("TYPESAFE_CONFIDENCE_THRESHOLD", 0.75),
				numberEnv("TYPESAFE_RISK_THRESHOLD", 0.8),
			);
			const { phase: nextPhase, route, phaseTransition } = decision;
			const target = routeTarget(route);
			const targetName = `${target.provider}/${target.model}`;
			if (nextPhase && phaseTransition) {
				currentPhase = nextPhase;
				try {
					pi.appendEntry(PHASE_STATE_ENTRY, { phase: currentPhase });
				} catch {
					// Phase persistence must never block the user's turn.
				}
			}
			activeDecision = {
				prompt_hash: baseLog.prompt_hash,
				phase: nextPhase,
				route,
				phase_transition: phaseTransition,
				current_model: model,
				target_model: targetName,
			};
			await writeLogSafely({
				...baseLog,
				requested_phase: answers.phase?.choice ?? null,
				phase: nextPhase ?? null,
				phase_confidence: phaseConfidence,
				phase_transition: phaseTransition,
				requested_route: answers.route?.choice ?? null,
				route,
				confidence,
				complexity: answers.complexity?.score ?? null,
				high_risk: highRisk,
				target_model: targetName,
				latency_ms: Date.now() - started,
				usage: result.usage ?? null,
			});

			if (mode === "shadow") {
				notify(
					ctx,
					`[TypeSafe shadow] ${nextPhase ?? route} → ${targetName} (${Math.max(phaseConfidence, confidence).toFixed(2)})`,
				);
				return;
			}
			if (mode !== "live") return;

			const applyModelChange = shouldApplyModelChange(
				model,
				targetName,
				phaseTransition,
				route,
				highRisk,
				numberEnv("TYPESAFE_RISK_THRESHOLD", 0.8),
				initialDecision,
			);
			if (applyModelChange) {
				const targetModel = ctx.modelRegistry.find(target.provider, target.model);
				if (!targetModel) throw new Error(`Model unavailable: ${targetName}`);
				if (!(await pi.setModel(targetModel))) throw new Error(`Authentication unavailable: ${targetName}`);
			}
			if (model !== targetName && !applyModelChange) {
				notify(ctx, `[TypeSafe] keeping ${model}; ${nextPhase ?? route} is unchanged`);
			} else {
				notify(ctx, `[TypeSafe] ${nextPhase ?? route} → ${targetName} (${Math.max(phaseConfidence, confidence).toFixed(2)})`);
			}
		} catch (error) {
			await writeLogSafely({
				...baseLog,
				error: error instanceof Error ? error.message : String(error),
				latency_ms: Date.now() - started,
			});
			notify(ctx, `[TypeSafe] routing skipped: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}

export type { Phase, Route };
