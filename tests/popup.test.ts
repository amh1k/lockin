// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, SessionState, WorkerMessage } from '../src/shared/types.ts';
const html = readFileSync('src/popup/index.html', 'utf8');
const now = 1_800_000_000_000;
const active: SessionState = { session: { id: 's', goal: 'Build the Stripe billing flow', startedAt: now, endsAt: now + 25 * 60_000, hosts: ['www.youtube.com'] }, overrides: [] };
let listener: (message: WorkerMessage) => void;
let ready = true;
let state: SessionState;
let send: ReturnType<typeof vi.fn>;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(now); ready = true; state = { session: null, overrides: [] };
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1]!;
  send = vi.fn(async (message: Command) => {
    if (message.type === 'GET_STATE') return { ok: true, data: { state, generation: null } };
    if (message.type === 'CHECK_READY') return { ok: true, data: { ready, error: 'missing-model' } };
    if (message.type === 'START_SESSION') return ready ? { ok: true, data: { state: active } } : { ok: false, error: 'Local Gemma is not ready (missing-model).' };
    if (message.type === 'END_SESSION') return { ok: true, data: { state: { session: null, overrides: [] } } };
    return { ok: false, error: 'Unexpected command' };
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: send, getURL: () => 'chrome-extension://lockin/', onMessage: { addListener: (fn: typeof listener) => { listener = fn; } } },
    tabs: { query: async () => [{ url: 'https://www.youtube.com/watch?v=test' }] },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  await import('../src/popup/index.ts'); await vi.advanceTimersByTimeAsync(0);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function fill() { byId<HTMLTextAreaElement>('goal').value = 'Build the Stripe billing flow'; byId('goal').dispatchEvent(new Event('input', { bubbles: true })); }
function submit() { byId('start-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }

describe('popup focus flow', () => {
  it('requires a meaningful goal and at least one supported site', () => {
    expect(byId<HTMLButtonElement>('start-session').disabled).toBe(true); fill();
    expect(byId<HTMLButtonElement>('start-session').disabled).toBe(false);
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="host"]')) input.checked = false;
    byId('start-form').dispatchEvent(new Event('change', { bubbles: true }));
    expect(byId<HTMLButtonElement>('start-session').disabled).toBe(true);
  });

  it('starts, shows session progress and ends a session', async () => {
    fill(); submit(); await vi.advanceTimersByTimeAsync(0);
    expect(byId('start-form').hidden).toBe(true); expect(byId('session-view').hidden).toBe(false);
    expect(byId('countdown').textContent).toBe('25:00'); expect(byId('session-goal').textContent).toBe(active.session!.goal);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(byId('countdown').textContent).toBe('24:00'); expect(byId<HTMLProgressElement>('session-progress').value).toBeGreaterThan(0);
    byId('end-session').click(); await vi.advanceTimersByTimeAsync(0);
    expect(byId('session-view').hidden).toBe(true); expect(byId('start-form').hidden).toBe(false);
  });

  it('keeps the form open and shows actionable model-download help on readiness failure', async () => {
    ready = false; fill(); submit(); await vi.advanceTimersByTimeAsync(0);
    expect(byId('session-view').hidden).toBe(true);
    expect(byId('notice').textContent).toContain('ollama pull gemma3:1b'); expect(byId<HTMLDetailsElement>('setup').open).toBe(true);
  });

  it('does not send duplicate start commands while busy', async () => {
    let resolve!: (value: unknown) => void;
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fill(); submit(); submit();
    expect(send.mock.calls.filter(([m]) => m.type === 'START_SESSION')).toHaveLength(1);
    expect(byId<HTMLButtonElement>('start-session').disabled).toBe(true);
    resolve({ ok: false, error: 'busy' }); await vi.advanceTimersByTimeAsync(0);
  });

  it('tracks session changes from the worker and completes the local countdown', async () => {
    listener({ type: 'SESSION_CHANGED', state: { ...active, session: { ...active.session!, endsAt: now + 1_000 } } });
    expect(byId('session-view').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(byId('session-view').hidden).toBe(true); expect(byId('notice').textContent).toContain('Session complete');
  });

  it('provides the exact extension origin and a bounded setup check', async () => {
    expect(byId('extension-origin').textContent).toBe('chrome-extension://lockin');
    send.mockImplementationOnce(() => new Promise(() => {})); byId('check-model').click();
    await vi.advanceTimersByTimeAsync(12_001);
    expect(byId<HTMLButtonElement>('check-model').disabled).toBe(false);
    expect(byId('setup-feedback').textContent).toContain('Reload');
  });
});
