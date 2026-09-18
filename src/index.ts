import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { chooseEffectiveRoute, routeTarget, type Route } from "./routing.ts";

const DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_LOG_PATH = join(homedir(), ".pi", "agent", "state", "typesafe-router.jsonl");

type TypeSafeResponse = {
	answers?: {
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
	pi.on("before_agent_start", async (event, ctx: ExtensionContext) => {
		const mode = process.env.TYPESAFE_ROUTING ?? "shadow";
		const apiKey = process.env.TYPESAFE_API_KEY;
		if (mode === "off" || !apiKey || !event.prompt.trim()) return;

		const started = Date.now();
		const prompt = event.prompt.slice(0, numberEnv("TYPESAFE_MAX_PROMPT_CHARS", 12000));
		const model = currentModel(ctx);
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
					state: { prompt, cwd: ctx.cwd, current_model: model },
					questions: {
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
			const highRisk = answers.high_risk?.noul ?? 0;
			const route = chooseEffectiveRoute(
				answers.route?.choice,
				confidence,
				highRisk,
				numberEnv("TYPESAFE_CONFIDENCE_THRESHOLD", 0.75),
				numberEnv("TYPESAFE_RISK_THRESHOLD", 0.8),
			);
			const target = routeTarget(route);
			const targetName = `${target.provider}/${target.model}`;
			await writeLogSafely({
				...baseLog,
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
				notify(ctx, `[TypeSafe shadow] ${route} → ${targetName} (${confidence.toFixed(2)})`);
				return;
			}
			if (mode !== "live") return;

			const targetModel = ctx.modelRegistry.find(target.provider, target.model);
			if (!targetModel) throw new Error(`Model unavailable: ${targetName}`);
			if (model !== targetName && !(await pi.setModel(targetModel))) {
				throw new Error(`Authentication unavailable: ${targetName}`);
			}
			notify(ctx, `[TypeSafe] ${route} → ${targetName} (${confidence.toFixed(2)})`);
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

export type { Route };
