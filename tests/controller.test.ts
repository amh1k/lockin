import { describe, expect, it, vi } from 'vitest';
import { createController } from '../src/background/controller.ts';
import type { LockInStore } from '../src/session/store.ts';
import type { AIResult, SessionState, Snapshot } from '../src/shared/types.ts';

const now = 1_800_000_000_000;
const sessionState: SessionState = {
  session: {
    id: 'session-a', goal: 'Build a useful subscription billing flow', startedAt: now,
    endsAt: now + 25 * 60_000, hosts: ['www.youtube.com'],
  },
  overrides: [],
};
const snapshot: Snapshot = {
  pageKey: 'https://www.youtube.com/watch?v=abc', modelUrl: 'www.youtube.com/watch',
  title: 'Gaming highlights', description: '', text: 'A long enough page snapshot for a model decision to be requested here.',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(classify: () => Promise<AIResult>) {
  let state = structuredClone(sessionState);
  let activeUrl = 'https://www.youtube.com/watch?v=abc';
  let tabActive = true;
  const sent: unknown[] = [];
  const storage = new Map<string, unknown>();
  const store = {
    read: vi.fn(async () => structuredClone(state)),
    write: vi.fn(async (next: SessionState) => { state = structuredClone(next); }),
  } as unknown as LockInStore;
  const chrome = {
    storage: { session: {
      get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) storage.set(key, value); }),
    } },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true) },
    tabs: {
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: activeUrl, active: tabActive })),
      query: vi.fn(async (options: { url?: string[]; active?: boolean }) => options.active && tabActive ? [{ id: 7, url: activeUrl }] : []),
      sendMessage: vi.fn(async (_tabId: number, message: unknown) => { sent.push(message); }),
    },
    scripting: { executeScript: vi.fn(async () => undefined) },
  };
  const controller = createController({ chrome, store, classify, clock: () => now, checkReady: async () => ({ ready: true }) });
  return {
    controller, chrome, sent,
    setUrl: (url: string) => { activeUrl = url; },
    setActive: (active: boolean) => { tabActive = active; },
  };
}

const sender = {
  tab: { id: 7 }, url: snapshot.pageKey, frameId: 0, documentId: 'doc-a',
};

describe('background controller stale-result protection', () => {
  it('does not apply a classification after the tab navigates', async () => {
    const result = deferred<AIResult>();
    const app = harness(() => result.promise);
    const initial = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;
    const generation = (initial.data as { generation: number | null }).generation!;
    const accepted = await app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation, requestId: 'req-a' }, sender);
    expect(accepted.ok).toBe(true);

    app.setUrl('https://www.youtube.com/watch?v=next');
    await app.controller.handleNavigation({ tabId: 7, frameId: 0, url: 'https://www.youtube.com/watch?v=next', documentId: 'doc-b' });
    result.resolve({ status: 'ok', label: 'distracting', reason: 'Unrelated page.', durationMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(app.sent).toEqual([]);
  });

  it('rejects a content command from a subframe', async () => {
    const app = harness(async () => ({ status: 'ok', label: 'relevant', reason: 'Matches goal.', durationMs: 1 }));
    const reply = await app.controller.handleMessage({ type: 'GET_STATE' }, { ...sender, frameId: 3 });
    expect(reply.ok).toBe(true);
    if (reply.ok) expect((reply.data as { generation: number | null }).generation).toBeNull();
  });

  it('rejects an oversized snapshot before inference', async () => {
    const classify = vi.fn(async () => ({ status: 'ok', label: 'relevant', reason: 'Matches goal.', durationMs: 1 }) as AIResult);
    const app = harness(classify);
    const initial = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
    if (!initial.ok) throw new Error('Expected state reply.');
    const large = { ...snapshot, text: 'x'.repeat(1_501) };
    const generation = (initial.data as { generation: number | null }).generation!;
    const reply = await app.controller.handleMessage({ type: 'EVALUATE', snapshot: large, generation, requestId: 'large' }, sender);
    expect(reply.ok).toBe(false);
    expect(classify).not.toHaveBeenCalled();
  });

  it('does not apply a pending result after the session ends', async () => {
    const result = deferred<AIResult>();
    const app = harness(() => result.promise);
    const initial = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
    if (!initial.ok) throw new Error('Expected state reply.');
    const generation = (initial.data as { generation: number | null }).generation!;
    await app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation, requestId: 'req-end' }, sender);
    const ended = await app.controller.handleMessage({ type: 'END_SESSION' }, sender);
    expect(ended.ok).toBe(true);
    result.resolve({ status: 'ok', label: 'distracting', reason: 'Unrelated page.', durationMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.sent).toEqual([]);
  });

  it('does not apply a result when the tab is no longer active', async () => {
    const result = deferred<AIResult>();
    const app = harness(() => result.promise);
    const initial = await app.controller.handleMessage({ type: 'GET_STATE' }, sender);
    if (!initial.ok) throw new Error('Expected state reply.');
    const generation = (initial.data as { generation: number | null }).generation!;
    await app.controller.handleMessage({ type: 'EVALUATE', snapshot, generation, requestId: 'req-hidden' }, sender);
    app.setActive(false);
    result.resolve({ status: 'ok', label: 'distracting', reason: 'Unrelated page.', durationMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.sent).toEqual([]);
  });
});
