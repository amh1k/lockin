import { MODEL_MESSAGE_TIMEOUT_MS } from '../config.ts';
import { extractSnapshot, isSupportedUrl, pageKey } from './extract.ts';
import { mountBarrier } from './overlay.ts';
import { sendCommand } from '../shared/messaging.ts';
import type { CommandRuntime } from '../shared/messaging.ts';
import type { SessionState, WorkerMessage } from '../shared/types.ts';

interface RuntimeLike extends CommandRuntime {
  onMessage: { addListener(listener: (message: WorkerMessage) => void): void };
}

const STARTED = Symbol.for('lockin.content.started');

export function startContent(document: Document, runtime: RuntimeLike): void {
  // Properties in the isolated world survive repeated bundle injection.
  if (Reflect.get(document, STARTED)) return;
  Reflect.set(document, STARTED, true);
  const view = document.defaultView!;
  let state: SessionState = { session: null, overrides: [] };
  let generation = 0;
  let epoch = 0;
  let currentRequest: string | null = null;
  let requestEndsAt = 0;
  let sampleTimer: ReturnType<typeof setTimeout> | undefined;
  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSnapshot = '';

  const barrier = mountBarrier(document, {
    override: async () => {
      const result = await sendCommand(runtime, { type: 'OVERRIDE_PAGE', pageKey: pageKey(view.location.href), generation });
      if (!result.ok) throw new Error(result.error);
      state = result.data.state;
    },
    end: async () => {
      const result = await sendCommand(runtime, { type: 'END_SESSION' });
      if (!result.ok) throw new Error(result.error);
      state = result.data.state;
      invalidate();
    },
  });

  function invalidate(): number {
    epoch += 1;
    currentRequest = null;
    requestEndsAt = 0;
    clearTimeout(sampleTimer);
    clearTimeout(titleTimer);
    barrier.render({ phase: 'idle' });
    return epoch;
  }

  async function sample(expected: number, followup = false): Promise<void> {
    const session = state.session;
    if (expected !== epoch || document.visibilityState !== 'visible' || !session || Date.now() >= session.endsAt) return;
    if (!isSupportedUrl(view.location.href, session.hosts) || state.overrides.includes(pageKey(view.location.href))) return;
    const snapshot = extractSnapshot(document, view.location.href);
    const encoded = JSON.stringify(snapshot);
    if (encoded === lastSnapshot) return;
    lastSnapshot = encoded;
    const id = crypto.randomUUID();
    currentRequest = id;
    requestEndsAt = Date.now() + MODEL_MESSAGE_TIMEOUT_MS;
    barrier.render({ phase: 'checking' });
    if (!followup) {
      titleTimer = setTimeout(() => {
        if (expected === epoch && document.title.trim() !== snapshot.title) void sample(expected, true);
      }, 1_300);
    }
    try {
      const reply = await sendCommand(runtime, { type: 'EVALUATE', snapshot, generation, requestId: id });
      if (!reply.ok && expected === epoch && currentRequest === id) {
        currentRequest = null;
        barrier.render({ phase: 'unavailable' });
      }
    } catch {
      if (expected === epoch && currentRequest === id) {
        currentRequest = null;
        barrier.render({ phase: 'unavailable' });
      }
    }
  }

  async function synchronize(): Promise<void> {
    const expected = invalidate();
    if (document.visibilityState !== 'visible') return;
    try {
      const reply = await sendCommand(runtime, { type: 'GET_STATE' });
      if (expected !== epoch) return;
      if (!reply.ok) throw new Error(reply.error);
      state = reply.data.state;
      generation = reply.data.generation ?? 0;
      lastSnapshot = '';
      if (state.session) sampleTimer = setTimeout(() => { void sample(expected); }, 700);
    } catch {
      if (expected === epoch) barrier.render({ phase: 'unavailable' });
    }
  }

  runtime.onMessage.addListener((message) => {
    if (message.type === 'RESAMPLE') {
      void synchronize();
    } else if (message.type === 'SESSION_CHANGED') {
      state = message.state;
      if (!state.session) invalidate();
      else void synchronize();
    } else if (message.type === 'EVALUATION_RESULT') {
      const reply = message.reply;
      const session = state.session;
      if (!session || session.id !== reply.correlation.sessionId || Date.now() >= session.endsAt ||
          document.visibilityState !== 'visible' || Date.now() >= requestEndsAt || reply.correlation.requestId !== currentRequest ||
          reply.correlation.generation !== generation || reply.pageKey !== pageKey(view.location.href)) return;
      currentRequest = null;
      const decision = reply.decision;
      if (state.overrides.includes(reply.pageKey)) barrier.render({ phase: 'idle' });
      else if (decision.action === 'block') barrier.render({ phase: 'blocked', goal: session.goal, reason: decision.reason, endsAt: session.endsAt });
      else if (decision.source === 'uncertain' || decision.source === 'unavailable') barrier.render({ phase: decision.source, reason: decision.reason });
      else barrier.render({ phase: 'idle' });
    }
  });

  document.addEventListener('visibilitychange', () => { void synchronize(); });
  view.addEventListener('pageshow', () => { void synchronize(); });
  view.addEventListener('popstate', () => { void synchronize(); });
  view.addEventListener('hashchange', () => { void synchronize(); });
  view.addEventListener('pagehide', invalidate);
  void synchronize();
}

declare const chrome: { runtime: RuntimeLike };
if (typeof chrome !== 'undefined' && typeof document !== 'undefined') startContent(document, chrome.runtime);
