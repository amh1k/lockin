import { MODEL_MESSAGE_TIMEOUT_MS } from '../config.ts';
import type { AIResult, ReadyResult, Snapshot } from '../shared/types.ts';

export const INFERENCE_TARGET = 'lockin-inference';
export type InferenceJob =
  | { target: typeof INFERENCE_TARGET; type: 'CLASSIFY'; requestId: string; goal: string; snapshot: Snapshot }
  | { target: typeof INFERENCE_TARGET; type: 'CHECK_READY'; requestId: string }
  | { target: typeof INFERENCE_TARGET; type: 'CANCEL'; requestId: string };
export interface InferenceReply { requestId: string; result: AIResult | ReadyResult }
export interface InferenceChrome {
  runtime: {
    getURL(path: string): string;
    getContexts(filter: { contextTypes: string[]; documentUrls: string[] }): Promise<unknown[]>;
    sendMessage(message: InferenceJob): Promise<unknown>;
  };
  offscreen: { createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void> };
}

/** The local page/worker avoids MV3's 30-second fetch-response lifetime limit. */
export function createInferenceClient(chrome: InferenceChrome) {
  let creating: Promise<void> | undefined;
  async function ensureDocument(): Promise<void> {
    if (!creating) {
      creating = (async () => {
        const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
        if (!contexts.length) await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Run bounded local Gemma inference in a dedicated worker while Chrome manages the service worker.' });
      })().finally(() => { creating = undefined; });
    }
    await creating;
  }

  async function run(job: InferenceJob, signal?: AbortSignal): Promise<InferenceReply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    let cancelled = false;
    try {
      return await Promise.race([
        (async () => {
          await ensureDocument();
          if (cancelled || signal?.aborted) throw new Error('cancelled');
          return chrome.runtime.sendMessage(job) as Promise<InferenceReply>;
        })(),
        new Promise<never>((_, reject) => {
          const cancel = () => {
            cancelled = true;
            void chrome.runtime.sendMessage({ target: INFERENCE_TARGET, type: 'CANCEL', requestId: job.requestId }).catch(() => undefined);
            reject(new Error('cancelled'));
          };
          abort = cancel;
          signal?.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(cancel, MODEL_MESSAGE_TIMEOUT_MS);
          if (signal?.aborted) cancel();
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  }

  async function classify(goal: string, snapshot: Snapshot, signal?: AbortSignal): Promise<AIResult> {
    const requestId = crypto.randomUUID();
    try {
      const reply = await run({ target: INFERENCE_TARGET, type: 'CLASSIFY', requestId, goal, snapshot }, signal);
      if (reply.requestId === requestId && 'status' in reply.result) return reply.result;
    } catch { /* unavailable results retain the existing fail-open policy */ }
    return { status: 'unavailable', error: 'network', durationMs: 0 };
  }

  async function checkReady(): Promise<ReadyResult> {
    const requestId = crypto.randomUUID();
    try {
      const reply = await run({ target: INFERENCE_TARGET, type: 'CHECK_READY', requestId });
      if (reply.requestId === requestId && 'ready' in reply.result) return reply.result;
    } catch { /* the popup supplies recovery instructions */ }
    return { ready: false, error: 'network' };
  }
  return { classify, checkReady };
}
