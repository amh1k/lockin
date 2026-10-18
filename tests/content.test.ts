// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.youtube.com/watch?v=abc","pretendToBeVisual":true}
import { expect, it, vi } from 'vitest';
import type { Command, SessionState, WorkerMessage } from '../src/shared/types.ts';

it('survives bundle reinjection, rejects old-session results and resynchronizes after visibility changes', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<main>A video page with useful metadata.</main>';
  const active: SessionState = { session: { id: 'first-session', goal: 'Build the Stripe billing flow', startedAt: Date.now(), endsAt: Date.now() + 25 * 60_000, hosts: ['www.youtube.com'] }, overrides: [] };
  let state = active;
  const listeners: Array<(message: WorkerMessage) => void> = [];
  const sendMessage = vi.fn(async (command: Command) => command.type === 'GET_STATE'
    ? { ok: true as const, data: { state, generation: 1 } }
    : { ok: true as const, data: { status: 'accepted' as const } });
  const runtime = { sendMessage, onMessage: { addListener: (fn: (message: WorkerMessage) => void) => { listeners.push(fn); } } };
  const { startContent } = await import('../src/content/index.ts');
  startContent(document, runtime);
  vi.resetModules();
  const reinjected = await import('../src/content/index.ts'); reinjected.startContent(document, runtime);
  expect(listeners).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(701);
  const command = sendMessage.mock.calls.find(([message]) => message.type === 'EVALUATE')![0];
  if (command.type !== 'EVALUATE') throw new Error('Expected evaluation.');
  const reply = { correlation: { sessionId: active.session!.id, tabId: 7, documentId: 'doc', generation: 1, requestId: command.requestId }, pageKey: window.location.href, decision: { action: 'block' as const, source: 'model' as const, reason: 'This is a distraction.' }, endsAt: active.session!.endsAt };
  listeners[0]!({ type: 'EVALUATION_RESULT', reply });
  const root = document.getElementById('lockin-overlay')!.shadowRoot!;
  expect(root.querySelector('[role="dialog"]')).not.toBeNull();
  state = { session: null, overrides: [] };
  listeners[0]!({ type: 'SESSION_CHANGED', state });
  listeners[0]!({ type: 'EVALUATION_RESULT', reply });
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sendMessage.mock.calls.filter(([m]) => m.type === 'GET_STATE')).toHaveLength(2);
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  window.dispatchEvent(new Event('pagehide'));
  vi.clearAllTimers(); vi.useRealTimers();
});
