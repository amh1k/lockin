import { INFERENCE_TIMEOUT_MS, LIMITS, MODEL, OLLAMA_BASE_URL } from '../config.ts';
import type { AIError, AIResult, Label, ReadyResult, Snapshot } from '../shared/types.ts';
import { buildPrompt, sanitizeModelUrl } from './prompt.ts';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'reason'],
  properties: {
    label: { type: 'string', enum: ['relevant', 'distracting', 'uncertain'] },
    reason: { type: 'string', minLength: 1, maxLength: LIMITS.reason },
  },
} as const;

class RequestFailure extends Error {
  readonly category: AIError;

  constructor(category: AIError) {
    super(category);
    this.category = category;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCategory(error: unknown): AIError {
  return error instanceof RequestFailure ? error.category : 'network';
}

function tokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validInput(goal: string, snapshot: Snapshot): boolean {
  if (typeof goal !== 'string' || goal.trim().length < LIMITS.goalMin || goal.trim().length > LIMITS.goalMax) return false;
  if (!isRecord(snapshot) || !['pageKey', 'modelUrl', 'title', 'description', 'text'].every(key => typeof snapshot[key] === 'string')) return false;
  try {
    sanitizeModelUrl(snapshot.modelUrl);
    return true;
  } catch {
    return false;
  }
}

export interface ClassifierDependencies {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

export function createClassifier(dependencies: ClassifierDependencies = {}) {
  // Resolve fetch at call time so importing this module has no environment side effects.
  const request: typeof globalThis.fetch = (...args) => (dependencies.fetch ?? globalThis.fetch)(...args);
  const now = dependencies.now ?? Date.now;

  async function withBudget<T>(operation: (signal: AbortSignal) => Promise<T>, externalSignal?: AbortSignal): Promise<T> {
    if (externalSignal?.aborted) throw new RequestFailure('network');
    const controller = new AbortController();
    let rejectBudget!: (reason: RequestFailure) => void;
    const budget = new Promise<never>((_resolve, reject) => { rejectBudget = reject; });
    const abort = () => {
      rejectBudget(new RequestFailure('network'));
      controller.abort();
    };
    const timer = setTimeout(() => {
      rejectBudget(new RequestFailure('timeout'));
      controller.abort();
    }, INFERENCE_TIMEOUT_MS);
    externalSignal?.addEventListener('abort', abort, { once: true });
    try {
      // The race also enforces the deadline when a fetch implementation ignores abort.
      return await Promise.race([operation(controller.signal), budget]);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    if (!response.ok) throw new RequestFailure('http');
    try {
      return await response.json();
    } catch {
      throw new RequestFailure('invalid');
    }
  }

  async function chat(goal: string, snapshot: Snapshot, signal: AbortSignal): Promise<Omit<Extract<AIResult, { status: 'ok' }>, 'durationMs'>> {
    const response = await request(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: buildPrompt(goal, snapshot),
        stream: false,
        format: OUTPUT_SCHEMA,
        options: { temperature: 0, num_predict: 128 },
      }),
      signal,
      redirect: 'error',
    });
    const envelope = await readJson(response);
    if (!isRecord(envelope) || !isRecord(envelope.message) || typeof envelope.message.content !== 'string') throw new RequestFailure('invalid');
    let output: unknown;
    try {
      output = JSON.parse(envelope.message.content);
    } catch {
      throw new RequestFailure('invalid');
    }
    if (
      !isRecord(output) || Object.keys(output).length !== 2 ||
      !['relevant', 'distracting', 'uncertain'].includes(output.label as string) ||
      typeof output.reason !== 'string' || !output.reason.trim() || output.reason.length > LIMITS.reason
    ) throw new RequestFailure('invalid');
    return {
      status: 'ok',
      label: output.label as Label,
      reason: output.reason.trim(),
      ...(tokenCount(envelope.prompt_eval_count) ? { inputTokens: envelope.prompt_eval_count } : {}),
      ...(tokenCount(envelope.eval_count) ? { outputTokens: envelope.eval_count } : {}),
    };
  }

  async function classify(goal: string, snapshot: Snapshot, signal?: AbortSignal): Promise<AIResult> {
    const startedAt = now();
    const durationMs = () => Math.max(0, now() - startedAt);
    if (!validInput(goal, snapshot)) return { status: 'unavailable', error: 'invalid', durationMs: durationMs() };
    if (signal?.aborted) return { status: 'unavailable', error: 'network', durationMs: durationMs() };
    if (!snapshot.title.trim() && snapshot.text.trim().length < LIMITS.sparseText) {
      return { status: 'ok', label: 'uncertain', reason: 'There is not enough page context to judge relevance.', durationMs: durationMs() };
    }
    try {
      const result = await withBudget(requestSignal => chat(goal, snapshot, requestSignal), signal);
      return { ...result, durationMs: durationMs() };
    } catch (error) {
      return { status: 'unavailable', error: errorCategory(error), durationMs: durationMs() };
    }
  }

  async function checkReady(): Promise<ReadyResult> {
    try {
      await withBudget(async signal => {
        const tags = await readJson(await request(`${OLLAMA_BASE_URL}/api/tags`, { signal, redirect: 'error' }));
        if (!isRecord(tags) || !Array.isArray(tags.models)) throw new RequestFailure('invalid');
        if (!tags.models.some(model => isRecord(model) && (model.name === MODEL || model.model === MODEL))) throw new RequestFailure('missing-model');
        // The same budget covers both discovery and a real schema-constrained inference.
        if (signal.aborted) throw new RequestFailure('timeout');
        await chat('Implement Stripe subscriptions in my web app.', {
          pageKey: '',
          modelUrl: 'www.youtube.com/watch',
          title: 'Implement Stripe subscriptions: integration tutorial',
          description: 'A development tutorial for subscription billing.',
          text: 'Learn to add Stripe subscriptions to a web application, create checkout sessions, and handle subscription webhooks.',
        }, signal);
      });
      return { ready: true };
    } catch (error) {
      return { ready: false, error: errorCategory(error) };
    }
  }

  return { classify, checkReady };
}

export const { classify, checkReady } = createClassifier();
