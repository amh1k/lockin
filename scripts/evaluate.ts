import { readFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { classify } from "../src/ai/classify.ts";
import { MODEL, OLLAMA_BASE_URL, PROMPT_VERSION } from "../src/config.ts";
import type { AIResult, Label, Snapshot } from "../src/shared/types.ts";

export interface EvaluationFixture {
  id: string;
  goal: string;
  snapshot: Snapshot;
  expected: Label;
}

export type EvaluationClassifier = (
  goal: string,
  snapshot: Snapshot,
) => Promise<AIResult>;

export interface FixtureResult {
  id: string;
  expected: Label;
  actual: Label | null;
  status: AIResult["status"];
  error?: Extract<AIResult, { status: "unavailable" }>["error"];
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  correct: boolean;
}

export interface EvalReport {
  total: number;
  correct: number;
  accuracy: number;
  expectedCounts: Record<Label, number>;
  actualCounts: Record<Label, number> & { unavailable: number };
  relevantFalseBlocks: number;
  distractingBlocked: number;
  distractingRecall: number | null;
  coldDurationMs: number | null;
  warmCount: number;
  warmP95Ms: number | null;
  metadata: {
    model: string;
    modelDigest?: string;
    quantization?: string;
    promptVersion: string;
    evaluatedAt: string;
    runtime: string;
    platform: string;
    cpu: string;
    memoryGiB: number;
  };
  results: FixtureResult[];
}

export interface EvaluationOptions {
  coldProbeDurationMs?: number;
  modelDigest?: string;
  quantization?: string;
}

/** Run fixtures sequentially. With a separate cold probe, all fixture calls count as warm. */
export async function evaluate(
  fixtures: EvaluationFixture[],
  classifier: EvaluationClassifier,
  options: EvaluationOptions = {},
): Promise<EvalReport> {
  const expectedCounts: Record<Label, number> = {
    relevant: 0,
    distracting: 0,
    uncertain: 0,
  };
  const actualCounts: Record<Label, number> & { unavailable: number } = {
    relevant: 0,
    distracting: 0,
    uncertain: 0,
    unavailable: 0,
  };
  const results: FixtureResult[] = [];
  const durations: number[] = [];

  for (const fixture of fixtures) {
    expectedCounts[fixture.expected] += 1;
    const startedAt = performance.now();
    let result: AIResult;
    let callDurationMs: number;
    try {
      result = await classifier(fixture.goal, fixture.snapshot);
      callDurationMs = result.durationMs;
    } catch {
      callDurationMs = performance.now() - startedAt;
      result = {
        status: "unavailable",
        error: "network",
        durationMs: callDurationMs,
      };
    }

    const actual = result.status === "ok" ? result.label : null;
    if (actual === null) actualCounts.unavailable += 1;
    else actualCounts[actual] += 1;
    durations.push(callDurationMs);
    results.push({
      id: fixture.id,
      expected: fixture.expected,
      actual,
      status: result.status,
      ...(result.status === "unavailable" ? { error: result.error } : {}),
      ...(result.status === "ok" && result.inputTokens !== undefined
        ? { inputTokens: result.inputTokens }
        : {}),
      ...(result.status === "ok" && result.outputTokens !== undefined
        ? { outputTokens: result.outputTokens }
        : {}),
      durationMs: callDurationMs,
      correct: actual === fixture.expected,
    });
  }

  const correct = results.filter((result) => result.correct).length;
  const falseBlocks = results.filter(
    (result) => result.expected === "relevant" && result.actual === "distracting",
  ).length;
  const distractingBlocked = results.filter(
    (result) => result.expected === "distracting" && result.actual === "distracting",
  ).length;
  const distractions = expectedCounts.distracting;
  const hasColdProbe = options.coldProbeDurationMs !== undefined;
  const warmDurations = (hasColdProbe ? durations : durations.slice(1)).sort((a, b) => a - b);
  const warmP95Ms = percentileNearestRank(warmDurations, 0.95);

  return {
    total: fixtures.length,
    correct,
    accuracy: fixtures.length === 0 ? 0 : correct / fixtures.length,
    expectedCounts,
    actualCounts,
    relevantFalseBlocks: falseBlocks,
    distractingBlocked,
    distractingRecall:
      distractions === 0 ? null : distractingBlocked / distractions,
    coldDurationMs: options.coldProbeDurationMs ?? durations[0] ?? null,
    warmCount: warmDurations.length,
    warmP95Ms,
    metadata: {
      model: MODEL,
      ...(options.modelDigest ? { modelDigest: options.modelDigest } : {}),
      ...(options.quantization ? { quantization: options.quantization } : {}),
      promptVersion: PROMPT_VERSION,
      evaluatedAt: new Date().toISOString(),
      runtime: `Node ${process.versions.node}`,
      platform: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? "unknown",
      memoryGiB: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    },
    results,
  };
}

function percentileNearestRank(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const rank = Math.ceil(percentile * values.length);
  return values[Math.max(0, rank - 1)] ?? null;
}

async function loadFixtures(name: "dev" | "holdout"): Promise<EvaluationFixture[]> {
  const url = new URL(`../eval/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8")) as EvaluationFixture[];
}

interface InstalledModel {
  digest: string;
  quantization: string;
}

export async function getInstalledModel(request: typeof fetch = fetch): Promise<InstalledModel> {
  let response: Response;
  try {
    response = await request(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Cannot reach local Ollama on 127.0.0.1:11434.");
  }
  if (!response.ok) throw new Error(`Ollama model lookup failed (HTTP ${response.status}).`);
  const tags: unknown = await response.json();
  if (typeof tags !== "object" || tags === null || !("models" in tags) || !Array.isArray(tags.models)) {
    throw new Error("Ollama returned an invalid model list.");
  }
  const model = tags.models.find((entry: unknown) =>
    typeof entry === "object" && entry !== null &&
    ("name" in entry && entry.name === MODEL || "model" in entry && entry.model === MODEL),
  );
  if (!model) throw new Error(`Required model ${MODEL} is not installed. Run: ollama pull ${MODEL}`);
  return {
    digest: typeof model.digest === "string" ? model.digest : "unknown",
    quantization: typeof model.details?.quantization_level === "string"
      ? model.details.quantization_level : "unknown",
  };
}

async function main(): Promise<void> {
  const requested = process.argv[2] ?? "both";
  if (requested !== "dev" && requested !== "holdout" && requested !== "both") {
    throw new Error("Usage: node scripts/evaluate.ts [dev|holdout|both]");
  }
  // Checking tags does not warm the model, unlike the extension's readiness check.
  const installed = await getInstalledModel();
  const development = await loadFixtures("dev");
  const coldFixture = development[0];
  if (!coldFixture) throw new Error("The development fixture set is empty.");
  const coldProbe = await classify(coldFixture.goal, coldFixture.snapshot);
  if (coldProbe.status !== "ok") {
    throw new Error(`Gemma cold probe failed (${coldProbe.error}). No fixture scores recorded.`);
  }
  const datasets: Array<"dev" | "holdout"> =
    requested === "both" ? ["dev", "holdout"] : [requested];

  for (const name of datasets) {
    const fixtures = await loadFixtures(name);
    const report = await evaluate(fixtures, classify, {
      coldProbeDurationMs: coldProbe.durationMs,
      modelDigest: installed.digest,
      quantization: installed.quantization,
    });
    const meetsGate = name === "holdout"
      ? report.correct >= 16 && report.relevantFalseBlocks <= 1 &&
        report.distractingBlocked >= 6 && report.warmCount === 20 &&
        report.warmP95Ms !== null && report.warmP95Ms <= 5_000
      : null;
    process.stdout.write(`${JSON.stringify({ dataset: name, meetsGate, ...report }, null, 2)}\n`);
  }
}

const scriptPath = process.argv[1];
if (scriptPath && fileURLToPath(import.meta.url) === scriptPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
