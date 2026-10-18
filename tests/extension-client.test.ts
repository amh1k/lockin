import { expect, it, vi } from 'vitest';
import { createInferenceClient } from '../src/ai/extension-client.ts';
import type { InferenceJob } from '../src/ai/extension-client.ts';

function harness() {
  const chrome = {
    runtime: {
      getURL: (path: string) => 'chrome-extension://lockin/' + path,
      getContexts: vi.fn(async () => [] as unknown[]),
      sendMessage: vi.fn(async (job: InferenceJob): Promise<unknown> => ({ requestId: job.requestId, result: { ready: true } })),
    },
    offscreen: { createDocument: vi.fn(async () => undefined) },
  };
  return { chrome, client: createInferenceClient(chrome) };
}
it('creates one local inference document for simultaneous callers', async () => {
  const { chrome, client } = harness();
  expect(await Promise.all([client.checkReady(), client.checkReady()])).toEqual([{ ready: true }, { ready: true }]);
  expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
  expect(chrome.offscreen.createDocument).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['WORKERS'], url: 'offscreen.html' }));
});
it('reuses the existing document after a service-worker restart', async () => {
  const { chrome, client } = harness(); chrome.runtime.getContexts.mockResolvedValue([{}]);
  expect(await client.checkReady()).toEqual({ ready: true }); expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
});
it('fails open when the inference document cannot be created', async () => {
  const { chrome, client } = harness(); chrome.offscreen.createDocument.mockRejectedValue(new Error('unavailable'));
  expect(await client.checkReady()).toEqual({ ready: false, error: 'network' });
});
it('cancels obsolete inference work and releases the caller promptly', async () => {
  const { chrome, client } = harness(); chrome.runtime.sendMessage.mockImplementation(async () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = client.classify('Build the billing flow', { pageKey: 'https://www.youtube.com/', modelUrl: 'www.youtube.com/', title: 'Video', description: '', text: '' }, controller.signal);
  await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalled());
  controller.abort();
  expect(await pending).toMatchObject({ status: 'unavailable', error: 'network' });
  expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CANCEL' }));
});
