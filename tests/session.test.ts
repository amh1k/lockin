import { describe, expect, it, vi } from 'vitest';
import { addOverride, decide, expire, startSession } from '../src/session/state.ts';
import { createStore, type ChromeStorageLike } from '../src/session/store.ts';
import type { AIResult, SessionState } from '../src/shared/types.ts';

const NOW = 1_800_000_000_000;
const HOSTS = ['www.youtube.com', 'www.reddit.com'] as const;
const PAGE_A = 'https://www.youtube.com/watch?v=alpha#start';
const PAGE_B = 'https://www.youtube.com/watch?v=beta#start';

const distracting: AIResult = {
  status: 'ok', label: 'distracting', reason: 'This video is unrelated to the goal.', durationMs: 80,
};

function activeState(): SessionState {
  return { session: startSession('  Finish my project report  ', 25, [...HOSTS], NOW), overrides: [] };
}

function fakeStorage() {
  const sessionData = new Map<string, unknown>();
  const localData = new Map<string, unknown>();
  const area = (data: Map<string, unknown>) => ({
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(data.get(key)) })),
    set: vi.fn(async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (key: string) => { data.delete(key); }),
    setAccessLevel: vi.fn(async (_options: { accessLevel: 'TRUSTED_CONTEXTS' }) => {}),
  });
  const storage = { session: area(sessionData), local: area(localData) } satisfies ChromeStorageLike;
  return { storage, sessionData, localData };
}

describe('session state', () => {
  it('trims a valid goal, makes a unique ID, and expires at the exact duration boundary', () => {
    const first = startSession('  Finish my project report  ', 25, [...HOSTS], NOW);
    const second = startSession('Finish my project report', 50, ['www.reddit.com'], NOW);
    expect(first.goal).toBe('Finish my project report');
    expect(first.id).not.toBe(second.id);
    expect(first.endsAt).toBe(NOW + 25 * 60_000);
    expect(second.endsAt).toBe(NOW + 50 * 60_000);
    const state = { session: first, overrides: [PAGE_A] };
    expect(expire(state, first.endsAt - 1).session?.id).toBe(first.id);
    expect(expire(state, first.endsAt)).toEqual({ session: null, overrides: [] });
    expect(state.overrides).toEqual([PAGE_A]);
  });

  it.each([9, 301])('rejects a trimmed goal of %i characters', (length) => {
    expect(() => startSession(` ${'x'.repeat(length)} `, 25, [...HOSTS], NOW)).toThrow();
  });

  it.each([10, 300])('accepts a trimmed goal of %i characters', (length) => {
    expect(startSession(` ${'x'.repeat(length)} `, 25, [...HOSTS], NOW).goal).toHaveLength(length);
  });

  it('rejects invalid durations, hosts, and timestamps', () => {
    expect(() => startSession('Finish my project report', 30 as 25, [...HOSTS], NOW)).toThrow();
    expect(() => startSession('Finish my project report', 25, [], NOW)).toThrow();
    expect(() => startSession('Finish my project report', 25, ['youtube.com' as 'www.youtube.com'], NOW)).toThrow();
    expect(() => startSession('Finish my project report', 25, [...HOSTS], Number.NaN)).toThrow();
    expect(() => startSession('Finish my project report', 25, [...HOSTS], Number.MAX_SAFE_INTEGER)).toThrow();
  });

  it('allows only the exact page and keeps query and fragment distinctions', () => {
    const before = activeState();
    const state = addOverride(before, PAGE_A);
    expect(decide(state.session, PAGE_A, state.overrides, distracting, NOW).action).toBe('allow');
    expect(decide(state.session, PAGE_A, state.overrides, distracting, NOW).source).toBe('override');
    expect(decide(state.session, PAGE_B, state.overrides, distracting, NOW).action).toBe('block');
    expect(decide(state.session, 'https://www.youtube.com/watch?v=alpha#other', state.overrides, distracting, NOW).action).toBe('block');
    expect(addOverride(state, PAGE_A).overrides).toHaveLength(1);
    expect(before.overrides).toEqual([]);
  });

  it('removes credentials from override identity and rejects unsupported pages', () => {
    const state = addOverride(activeState(), 'https://user:secret@www.youtube.com/watch?v=alpha#start');
    expect(state.overrides).toEqual([PAGE_A]);
    expect(JSON.stringify(state)).not.toContain('secret');
    expect(() => addOverride(state, 'http://www.youtube.com/watch')).toThrow();
    expect(() => addOverride(state, 'https://www.youtube.com.attacker.example/watch')).toThrow();
    expect(() => addOverride({ ...state, session: null }, PAGE_A)).toThrow();
  });

  it('caps overrides at 100 without silently removing an earlier one', () => {
    let state = activeState();
    for (let i = 0; i < 100; i++) state = addOverride(state, `https://www.youtube.com/watch?v=${i}`);
    expect(state.overrides).toHaveLength(100);
    expect(() => addOverride(state, 'https://www.youtube.com/watch?v=overflow')).toThrow('100');
    expect(state.overrides[0]).toBe('https://www.youtube.com/watch?v=0');
  });

  it('fails open for inactive, expired, uncertain, unavailable, and unsupported pages', () => {
    const session = activeState().session;
    expect(decide(null, PAGE_A, [], distracting, NOW)).toMatchObject({ action: 'allow', source: 'inactive' });
    expect(decide(session, PAGE_A, [], distracting, session!.endsAt)).toMatchObject({ action: 'allow', source: 'inactive' });
    expect(decide(session, PAGE_A, [], { status: 'ok', label: 'uncertain', reason: 'Ambiguous', durationMs: 2 }, NOW)).toMatchObject({ action: 'allow', source: 'uncertain' });
    expect(decide(session, PAGE_A, [], { status: 'unavailable', error: 'timeout', durationMs: 10_000 }, NOW)).toMatchObject({ action: 'allow', source: 'unavailable' });
    expect(decide(session, 'https://example.com', [], distracting, NOW)).toMatchObject({ action: 'allow', source: 'unavailable' });
    expect(decide(session, PAGE_A, [], distracting, NOW)).toMatchObject({ action: 'block', source: 'model' });
  });
});

describe('Chrome storage adapter', () => {
  it('persists the active state across store instances, then clears it on expiry', async () => {
    const { storage, sessionData, localData } = fakeStorage();
    const first = createStore(storage, () => NOW);
    await first.write(activeState());
    expect((await createStore(storage, () => NOW + 1).read()).session?.goal).toBe('Finish my project report');
    expect(sessionData.size).toBe(1);
    expect(localData.size).toBe(0);
    expect(await createStore(storage, () => NOW + 25 * 60_000).read()).toEqual({ session: null, overrides: [] });
    expect(sessionData.size).toBe(0);
  });

  it('keeps preferences in local storage without persisting the goal there', async () => {
    const { storage, localData } = fakeStorage();
    const first = createStore(storage, () => NOW);
    expect(await first.readPreferences()).toEqual({ hosts: [...HOSTS], durationMinutes: 25 });
    await first.writePreferences({ hosts: ['www.reddit.com'], durationMinutes: 50 });
    await first.write(activeState());
    expect(await createStore(storage, () => NOW).readPreferences()).toEqual({ hosts: ['www.reddit.com'], durationMinutes: 50 });
    expect(JSON.stringify([...localData.values()])).not.toContain('Finish my project report');
  });

  it('limits both storage areas to trusted extension contexts once per instance', async () => {
    const { storage } = fakeStorage();
    const store = createStore(storage, () => NOW);
    await store.read();
    await store.readPreferences();
    await store.write(activeState());
    expect(storage.session.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(storage.local.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('discards malformed or expired stored state', async () => {
    const { storage, sessionData } = fakeStorage();
    sessionData.set('lockin.sessionState', { session: { goal: 'tampered' }, overrides: [PAGE_A] });
    expect(await createStore(storage, () => NOW).read()).toEqual({ session: null, overrides: [] });
    expect(sessionData.size).toBe(0);
    sessionData.set('lockin.sessionState', activeState());
    expect(await createStore(storage, () => NOW + 25 * 60_000).read()).toEqual({ session: null, overrides: [] });
  });

  it('rejects invalid preferences and clears session data on explicit end', async () => {
    const { storage, sessionData } = fakeStorage();
    const store = createStore(storage, () => NOW);
    await expect(store.writePreferences({ hosts: [], durationMinutes: 25 })).rejects.toThrow();
    await store.write(addOverride(activeState(), PAGE_A));
    await store.write({ session: null, overrides: [] });
    expect(sessionData.size).toBe(0);
  });

  it('starts inactive after a browser restart while keeping local preferences', async () => {
    const { storage, sessionData } = fakeStorage();
    const beforeRestart = createStore(storage, () => NOW);
    await beforeRestart.write(activeState());
    await beforeRestart.writePreferences({ hosts: ['www.reddit.com'], durationMinutes: 50 });
    sessionData.clear();
    const afterRestart = createStore(storage, () => NOW + 1);
    expect(await afterRestart.read()).toEqual({ session: null, overrides: [] });
    expect(await afterRestart.readPreferences()).toEqual({ hosts: ['www.reddit.com'], durationMinutes: 50 });
  });

  it('does not read private state when storage access cannot be restricted', async () => {
    const { storage } = fakeStorage();
    storage.session.setAccessLevel.mockRejectedValueOnce(new Error('access denied'));
    await expect(createStore(storage, () => NOW).read()).rejects.toThrow('access denied');
    expect(storage.session.get).not.toHaveBeenCalled();
  });
});
