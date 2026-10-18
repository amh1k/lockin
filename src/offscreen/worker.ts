import { createClassifier } from '../ai/classify.ts';
import type { InferenceJob, InferenceReply } from '../ai/extension-client.ts';

const scope = globalThis as unknown as { onmessage: (event: MessageEvent<InferenceJob>) => void; postMessage(reply: InferenceReply): void };
const classifier = createClassifier();
let active: { requestId: string; controller: AbortController } | null = null;
scope.onmessage = (event) => {
  const job = event.data;
  if (job.type === 'CANCEL') {
    if (active?.requestId === job.requestId) active.controller.abort();
    return;
  }
  if (active) {
    scope.postMessage({ requestId: job.requestId, result: job.type === 'CHECK_READY' ? { ready: false, error: 'busy' } : { status: 'unavailable', error: 'busy', durationMs: 0 } });
    return;
  }
  const controller = new AbortController();
  active = { requestId: job.requestId, controller };
  void (async () => {
    try {
      const result = job.type === 'CHECK_READY' ? await classifier.checkReady() : await classifier.classify(job.goal, job.snapshot, controller.signal);
      scope.postMessage({ requestId: job.requestId, result });
    } catch {
      scope.postMessage({ requestId: job.requestId, result: job.type === 'CHECK_READY' ? { ready: false, error: 'network' } : { status: 'unavailable', error: 'network', durationMs: 0 } });
    } finally { active = null; }
  })();
};
