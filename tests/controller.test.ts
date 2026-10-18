import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/background/controller.ts';
import type { AIResult, SessionState, Snapshot, WorkerMessage } from '../src/shared/types.ts';

const now = 1_800_000_000_000;
const initialState: SessionState = {
  session: { id: 'session-a', goal: 'Build a useful subscription billing flow', startedAt: now, endsAt: now + 25 * 60_000, hosts: ['www.youtube.com'] },
  overrides: [],
};
const snapshot: Snapshot = { pageKey: 'https://www.youtube.com/watch?v=abc', modelUrl: 'www.youtube.com/watch', title: 'Gaming highlights', description: '', text: 'A long enough page snapshot for a model decision to be requested here.' };
const sender = { tab: { id: 7 }, url: snapshot.pageKey, frameId: 0, documentId: 'doc-a' };
const popup = { url: 'chrome-extension://lockin/popup.html' };
const distracting: AIResult = { status: 'ok', label: 'distracting', reason: 'Unrelated page.', durationMs: 5 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(classifier: () => Promise<AIResult> = async () => distracting) {
  let state = structuredClone(initialState);
  let activeUrl = snapshot.pageKey;
  let tabActive = true;
  let documentId = 'doc-a';
  const sent: WorkerMessage[] = [];
  const storage = new Map<string, unknown>();
  const store = {
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (next: SessionState) => { state = structuredClone(next); }),
    readPreferences: vi.fn(async () => ({ hosts: ['www.youtube.com' as const], durationMinutes: 25 as const })),
    writePreferences: vi.fn(async () => undefined),
  };
  const chrome = {
    runtime: { id: 'lockin', sendMessage: vi.fn(async () => undefined) },
    webNavigation: { getFrame: vi.fn(async () => ({ documentId, url: activeUrl })) },
    storage: { session: {
      get: vi.fn(async (key: string) => ({ [key]: structuredClone(storage.get(key)) })),
      set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) storage.set(key, structuredClone(value)); }),
    } },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
    tabs: {
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: activeUrl, active: tabActive })),
      query: vi.fn(async (options: { url?: string[]; active?: boolean }) => options.active && tabActive ? [{ id: 7, url: activeUrl }] : []),
      sendMessage: vi.fn(async (_tabId: number, message: WorkerMessage) => { sent.push(message); }),
    },
    scripting: { executeScript: vi.fn(async () => undefined) },
  };
  const classify = vi.fn(classifier);
  const checkReady = vi.fn(async () => ({ ready: true }));
  const controller = createController({ chrome, store, classify, clock: () => now, checkReady });
  const results = () => sent.filter((m) => m.type === 'EVALUATION_RESULT');
  return { controller, chrome, sent, classify, checkReady, store, results,
    setState: (next: SessionState) => { state = next; },
    setUrl: (url: string, doc = documentId) => { activeUrl = url; documentId = doc; },
    setActive: (active: boolean) => { tabActive = active; },
  };
}

async function generation(app: ReturnType<typeof harness>): Promise<number> {
  const reply = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
  if (!reply.ok || !('generation' in reply.data)) throw new Error('Expected state reply.');
  return reply.data.generation!;
}

afterEach(() => vi.useRealTimers());

describe('controller lifecycle and message authority', () => {
  it('delivers a valid current-page result', async () => {
    const app = harness(); const gen = await generation(app);
    await app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation: gen, requestId: 'valid' }, sender);
    expect(app.results()).toHaveLength(1);
    expect(app.results()[0]!.reply.decision.action).toBe('block');
  });

  it.each(['navigation', 'end', 'hidden', 'new-session', 'override'] as const)('never applies a stale block after %s', async (change) => {
    const result = deferred<AIResult>(); const app = harness(() => result.promise); const gen = await generation(app);
    const pending = app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation: gen, requestId: 'pending' }, sender);
    await vi.waitFor(() => expect(app.classify).toHaveBeenCalledOnce());
    if (change === 'navigation') {
      app.setUrl('https://www.youtube.com/watch?v=next', 'doc-b');
      await app.controller.handleNavigation({ tabId: 7, frameId: 0, url: 'https://www.youtube.com/watch?v=next', documentId: 'doc-b' });
    } else if (change === 'end') await app.controller.handleMessage({ type: 'END_SESSION' }, popup);
    else if (change === 'hidden') app.setActive(false);
    else if (change === 'new-session') app.setState({ ...initialState, session: { ...initialState.session!, id: 'new-session' } });
    else await app.controller.handleMessage({ type: 'OVERRIDE_PAGE', pageKey: snapshot.pageKey, generation: gen }, sender);
    result.resolve(distracting); await pending;
    expect(app.results().some((message) => message.reply.decision.action === 'block')).toBe(false);
  });

  it('rejects subframe access to the goal', async () => {
    const app = harness();
    expect((await app.controller.handleMessage({ type: 'GET_STATE' }, { ...sender, frameId: 3 })).ok).toBe(false);
  });

  it('rejects stale documents without overwriting a newer generation', async () => {
    const app = harness(); const gen = await generation(app);
    app.setUrl('https://www.youtube.com/watch?v=next', 'doc-b');
    await app.controller.handleNavigation({ tabId: 7, frameId: 0, url: 'https://www.youtube.com/watch?v=next', documentId: 'doc-b' });
    const reply = await app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation: gen, requestId: 'old' }, sender);
    expect(reply.ok).toBe(false);
    expect(app.classify).not.toHaveBeenCalled();
    const latest = await app.chrome.storage.session.get('lockin.generations');
    expect(latest['lockin.generations']).toMatchObject({ '7': { documentId: 'doc-b', generation: gen + 1 } });
  });

  it('recovers generations after creating a fresh controller', async () => {
    const app = harness(); const gen = await generation(app);
    const fresh = createController({ chrome: app.chrome, store: app.store, classify: app.classify, checkReady: app.checkReady, clock: () => now });
    const reply = await fresh.handleMessage({ type: 'GET_STATE' }, sender);
    expect(reply).toMatchObject({ ok: true, data: { generation: gen, state: initialState } });
  });

  it('rejects oversized snapshots and forged generations before inference', async () => {
    const app = harness(); const gen = await generation(app);
    for (const command of [
      { type: 'EVALUATE' as const, snapshot: { ...snapshot, text: 'x'.repeat(1_501) }, generation: gen, requestId: 'large' },
      { type: 'EVALUATE' as const, snapshot, generation: gen + 9, requestId: 'forged' },
    ]) expect((await app.controller.handleMessage(command, sender)).ok).toBe(false);
    expect(app.classify).not.toHaveBeenCalled();
  });

  it('enforces popup-only start and readiness commands', async () => {
    const app = harness();
    expect((await app.controller.handleMessage({ type: 'CHECK_READY' }, sender)).ok).toBe(false);
    expect((await app.controller.handleMessage({ type: 'CHECK_READY' }, { url: 'chrome-extension://another/popup.html' })).ok).toBe(false);
    expect(app.checkReady).not.toHaveBeenCalled();
  });

  it('keeps focus off if the readiness gate fails', async () => {
    const app = harness(); app.setState({ session: null, overrides: [] }); app.checkReady.mockResolvedValue({ ready: false });
    const reply = await app.controller.handleMessage({ type: 'START_SESSION', goal: initialState.session!.goal, durationMinutes: 25, hosts: ['www.youtube.com'] }, popup);
    expect(reply.ok).toBe(false); expect(app.store.write).not.toHaveBeenCalled();
  });

  it('reserves the model slot before asynchronous foreground checks', async () => {
    vi.useFakeTimers();
    const result = deferred<AIResult>(); const app = harness(() => result.promise); const gen = await generation(app);
    const first = app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation: gen, requestId: 'first' }, sender);
    const second = app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation: gen, requestId: 'second' }, sender);
    await vi.advanceTimersByTimeAsync(1_001);
    await second;
    expect(app.classify).toHaveBeenCalledOnce();
    const readyReply = await app.controller.handleMessage({ type: 'CHECK_READY' }, popup);
    expect(readyReply).toMatchObject({ ok: true, data: { ready: false, error: 'busy' } });
    result.resolve(distracting); await first;
  });

  it('serializes concurrent exact-page overrides', async () => {
    const app = harness(); const gen = await generation(app);
    const replies = await Promise.all([1, 2].map(() => app.controller.handleMessage({ type: 'OVERRIDE_PAGE', pageKey: snapshot.pageKey, generation: gen }, sender)));
    expect(replies.every((reply) => reply.ok)).toBe(true);
    expect((await app.store.read()).overrides).toEqual([snapshot.pageKey]);
  });
  it('does not retain navigation URLs while focus is off', async () => {
    const app = harness(); app.setState({ session: null, overrides: [] });
    const reply = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
    expect(reply).toMatchObject({ ok: true, data: { generation: null } });
    await app.controller.handleNavigation({ tabId: 7, frameId: 0, url: snapshot.pageKey, documentId: 'doc-a' });
    expect(app.chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it('clears generation metadata when a session ends', async () => {
    const app = harness(); await generation(app);
    await app.controller.handleMessage({ type: 'END_SESSION' }, popup);
    expect(await app.chrome.storage.session.get('lockin.generations')).toEqual({ 'lockin.generations': {} });
  });

  it('does not let a delayed expiry alarm clear a newly started session', async () => {
    const app = harness(); app.setState({ session: null, overrides: [] });
    const ready = deferred<{ ready: boolean }>(); app.checkReady.mockImplementationOnce(() => ready.promise);
    const starting = app.controller.handleMessage({ type: 'START_SESSION', goal: initialState.session!.goal, durationMinutes: 25, hosts: ['www.youtube.com'] }, popup);
    await vi.waitFor(() => expect(app.checkReady).toHaveBeenCalledOnce());
    const alarm = app.controller.handleAlarm('lockin.session-expiry');
    ready.resolve({ ready: true }); await Promise.all([starting, alarm]);
    expect((await app.store.read()).session).not.toBeNull();
  });

});
