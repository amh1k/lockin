import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkReady, classify } from "../src/ai/classify.ts";
import { MODEL, PROMPT_VERSION } from "../src/config.ts";
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
  warmP95Ms: number | null;
  metadata: {
    model: string;
    promptVersion: string;
    evaluatedAt: string;
    runtime: string;
  };
  results: FixtureResult[];
}

/** Run fixtures sequentially so the first inference can be reported separately. */
export async function evaluate(
  fixtures: EvaluationFixture[],
  classifier: EvaluationClassifier,
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
  const warmDurations = durations.slice(1).sort((a, b) => a - b);
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
    coldDurationMs: durations[0] ?? null,
    warmP95Ms,
    metadata: {
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      evaluatedAt: new Date().toISOString(),
      runtime: `Node ${process.versions.node}`,
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

async function main(): Promise<void> {
  const requested = process.argv[2] ?? "both";
  if (requested !== "dev" && requested !== "holdout" && requested !== "both") {
    throw new Error("Usage: node scripts/evaluate.ts [dev|holdout|both]");
  }
  const readiness = await checkReady();
  if (!readiness.ready) {
    throw new Error(`Local Gemma is not ready (${readiness.error ?? "unknown"}). Start Ollama and install the configured model before evaluating.`);
  }
  const datasets: Array<"dev" | "holdout"> =
    requested === "both" ? ["dev", "holdout"] : [requested];

  for (const name of datasets) {
    const fixtures = await loadFixtures(name);
    const report = await evaluate(fixtures, classify);
    process.stdout.write(`${JSON.stringify({ dataset: name, ...report }, null, 2)}\n`);
  }
}

const scriptPath = process.argv[1];
if (scriptPath && fileURLToPath(import.meta.url) === scriptPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
