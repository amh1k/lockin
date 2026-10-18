import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InferenceJob, InferenceReply } from '../src/ai/extension-client.ts';

let listener: (job: InferenceJob, sender: { id?: string; tab?: unknown }, respond: (reply: unknown) => void) => boolean | void;
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: InferenceReply }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor(public url: string) { FakeWorker.instances.push(this); }
}
const job: InferenceJob = { target: 'lockin-inference', type: 'CHECK_READY', requestId: 'ready-1' };
beforeEach(async () => {
  vi.resetModules(); FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('chrome', { runtime: { id: 'lockin', getURL: (p: string) => 'chrome-extension://lockin/' + p, onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } } });
  await import('../src/offscreen/index.ts');
});
afterEach(() => vi.unstubAllGlobals());
it('delegates trusted model jobs to a dedicated local worker and routes their result', () => {
  const respond = vi.fn(); expect(listener(job, { id: 'lockin' }, respond)).toBe(true);
  const worker = FakeWorker.instances[0]!;
  expect(worker.url).toBe('chrome-extension://lockin/inference-worker.js'); expect(worker.postMessage).toHaveBeenCalledWith(job);
  worker.onmessage!({ data: { requestId: job.requestId, result: { ready: true } } });
  expect(respond).toHaveBeenCalledWith({ requestId: job.requestId, result: { ready: true } });
});
it('ignores requests from content scripts and other extensions', () => {
  const respond = vi.fn(); listener(job, { id: 'other' }, respond); listener(job, { id: 'lockin', tab: {} }, respond);
  expect(FakeWorker.instances).toHaveLength(0); expect(respond).not.toHaveBeenCalled();
});
it('fails pending jobs open after a worker crash and can create a replacement', () => {
  const respond = vi.fn(); listener(job, { id: 'lockin' }, respond);
  FakeWorker.instances[0]!.onerror!();
  expect(respond).toHaveBeenCalledWith({ requestId: job.requestId, result: { ready: false, error: 'network' } });
  listener({ ...job, requestId: 'retry' }, { id: 'lockin' }, vi.fn());
  expect(FakeWorker.instances).toHaveLength(2);
});
