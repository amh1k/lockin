import { INFERENCE_TARGET } from '../ai/extension-client.ts';
import type { InferenceJob, InferenceReply } from '../ai/extension-client.ts';

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: { addListener(listener: (message: InferenceJob, sender: { id?: string; tab?: unknown }, respond: (reply: unknown) => void) => boolean | void): void };
  };
};

let worker: Worker | undefined;
const pending = new Map<string, { job: InferenceJob; respond(reply: InferenceReply): void }>();
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL('inference-worker.js'), { type: 'module' });
    worker.onmessage = (event: MessageEvent<InferenceReply>) => {
      const request = pending.get(event.data.requestId);
      if (request) { pending.delete(event.data.requestId); request.respond(event.data); }
    };
    worker.onerror = () => {
      worker?.terminate(); worker = undefined;
      for (const [requestId, request] of pending) request.respond({ requestId, result: request.job.type === 'CHECK_READY' ? { ready: false, error: 'network' } : { status: 'unavailable', error: 'network', durationMs: 0 } });
      pending.clear();
    };
  }
  return worker;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== INFERENCE_TARGET || sender.id !== chrome.runtime.id || sender.tab) return;
  if (message.type === 'CANCEL') {
    worker?.postMessage(message);
    respond({ cancelled: true });
    return;
  }
  if (message.type !== 'CHECK_READY' && message.type !== 'CLASSIFY') return;
  pending.set(message.requestId, { job: message, respond });
  try { getWorker().postMessage(message); } catch {
    pending.delete(message.requestId);
    respond({ requestId: message.requestId, result: message.type === 'CHECK_READY' ? { ready: false, error: 'network' } : { status: 'unavailable', error: 'network', durationMs: 0 } });
  }
  return true;
});
