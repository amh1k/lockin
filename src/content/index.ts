import { extractSnapshot, isSupportedUrl } from './extract.ts';
import { mountBarrier } from './overlay.ts';
import type { Barrier } from './overlay.ts';
import type { Command, CommandReply, EvaluationReply, SessionState, WorkerMessage } from '../shared/types.ts';

const NAVIGATION_SETTLE_MS = 700;
const TITLE_RESAMPLE_MS = 1_300;

interface RuntimeLike {
  sendMessage(message: Command): Promise<CommandReply>;
  onMessage: { addListener(listener: (message: WorkerMessage) => void): void };
}

interface ChromeLike { runtime: RuntimeLike }

const startedDocuments = new WeakSet<Document>();

function requestId(): string {
  return crypto.randomUUID();
}

export function startContent(document: Document, runtime: RuntimeLike): void {
  if (startedDocuments.has(document)) return;
  startedDocuments.add(document);
  let state: SessionState = { session: null, overrides: [] };
  let generation = 0;
  let currentRequest: string | null = null;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let titleRetry: ReturnType<typeof setTimeout> | undefined;
  let lastTitle = document.title;
  let lastSnapshot = '';
  let titleResampledGeneration = -1;
  let barrier: Barrier | undefined;

  const ensureBarrier = (): Barrier => barrier ??= mountBarrier(document, {
    override: async () => {
      const key = extractSnapshot(document, location.href).pageKey;
      const result = await runtime.sendMessage({ type: 'OVERRIDE_PAGE', pageKey: key, generation });
      if (!result.ok) throw new Error(result.error);
    },
    end: async () => {
      const result = await runtime.sendMessage({ type: 'END_SESSION' });
      if (!result.ok) throw new Error(result.error);
    },
  });

  const clearTimers = (): void => {
    if (scheduled !== undefined) clearTimeout(scheduled);
    if (titleRetry !== undefined) clearTimeout(titleRetry);
    scheduled = undefined;
    titleRetry = undefined;
  };

  const showDecision = (reply: EvaluationReply): void => {
    if (reply.correlation.generation !== generation || reply.pageKey !== extractSnapshot(document, location.href).pageKey) return;
    if (reply.decision.action === 'block') {
      ensureBarrier().render({ phase: 'blocked', ...(state.session ? { goal: state.session.goal } : {}), reason: reply.decision.reason, endsAt: reply.endsAt });
    } else if (reply.decision.source === 'uncertain') {
      ensureBarrier().render({ phase: 'uncertain', reason: reply.decision.reason });
    } else if (reply.decision.source === 'unavailable') {
      ensureBarrier().render({ phase: 'unavailable', reason: reply.decision.reason });
    } else {
      ensureBarrier().render({ phase: 'idle' });
    }
  };

  const sample = async (expectedGeneration: number, checkTitle = false): Promise<void> => {
    if (expectedGeneration !== generation || !document.visibilityState || document.visibilityState === 'hidden') return;
    const session = state.session;
    if (!session || Date.now() >= session.endsAt || !isSupportedUrl(location.href, session.hosts)) {
      ensureBarrier().render({ phase: 'idle' });
      return;
    }
    let snapshot;
    try { snapshot = extractSnapshot(document, location.href); } catch {
      ensureBarrier().render({ phase: 'unavailable' });
      return;
    }
    const encoded = JSON.stringify(snapshot);
    if (encoded === lastSnapshot && !checkTitle) return;
    lastSnapshot = encoded;
    lastTitle = snapshot.title;
    ensureBarrier().render({ phase: 'checking' });
    const id = requestId();
    currentRequest = id;
    try {
      const reply = await runtime.sendMessage({ type: 'EVALUATE', snapshot, generation: expectedGeneration, requestId: id });
      if (!reply.ok && expectedGeneration === generation && currentRequest === id) {
        currentRequest = null;
        ensureBarrier().render({ phase: 'unavailable' });
      }
    } catch {
      if (expectedGeneration === generation && currentRequest === id) {
        currentRequest = null;
        ensureBarrier().render({ phase: 'unavailable' });
      }
    }
    if (titleRetry !== undefined) clearTimeout(titleRetry);
    if (!checkTitle && expectedGeneration === generation && titleResampledGeneration !== generation) {
      titleRetry = setTimeout(() => {
        if (document.title.trim() && document.title.trim() !== lastTitle) {
          titleResampledGeneration = expectedGeneration;
          void sample(expectedGeneration, true);
        }
      }, TITLE_RESAMPLE_MS);
    }
  };

  const schedule = (nextGeneration = generation): void => {
    clearTimers();
    currentRequest = null;
    titleResampledGeneration = -1;
    ensureBarrier().render({ phase: 'idle' });
    scheduled = setTimeout(() => { void sample(nextGeneration); }, NAVIGATION_SETTLE_MS);
  };

  runtime.onMessage.addListener((message) => {
    if (message.type === 'RESAMPLE') {
      generation = message.generation;
      lastSnapshot = '';
      schedule(generation);
    } else if (message.type === 'SESSION_CHANGED') {
      state = message.state;
      lastSnapshot = '';
      if (!state.session) {
        clearTimers();
        currentRequest = null;
        ensureBarrier().render({ phase: 'idle' });
      } else {
        schedule();
      }
    } else if (message.type === 'EVALUATION_RESULT') {
      if (message.reply.correlation.requestId !== currentRequest) return;
      currentRequest = null;
      showDecision(message.reply);
    }
  });

  const stateChanged = (): void => {
    if (document.visibilityState === 'visible') {
      lastSnapshot = '';
      schedule();
    }
  };
  document.addEventListener('visibilitychange', stateChanged);
  window.addEventListener('pageshow', stateChanged);
  window.addEventListener('popstate', stateChanged);
  window.addEventListener('hashchange', stateChanged);

  void runtime.sendMessage({ type: 'GET_STATE' }).then((reply) => {
    if (!reply.ok) { ensureBarrier().render({ phase: 'unavailable' }); return; }
    const data = reply.data as Extract<CommandReply<'GET_STATE'>, { ok: true }>['data'];
    state = data.state;
    generation = data.generation ?? 0;
    if (state.session) schedule();
  }).catch(() => ensureBarrier().render({ phase: 'unavailable' }));
}

declare const chrome: ChromeLike;
if (typeof chrome !== 'undefined' && typeof document !== 'undefined') startContent(document, chrome.runtime);
