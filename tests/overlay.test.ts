// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODEL_MESSAGE_TIMEOUT_MS } from '../src/config.ts';
import { mountBarrier } from '../src/content/overlay.ts';
import type { Barrier } from '../src/content/overlay.ts';

let barrier: Barrier;
const shadow = () => document.getElementById('lockin-overlay')!.shadowRoot!;
const blocked = () => ({ phase: 'blocked' as const, goal: 'Build the billing flow', reason: 'Gaming is unrelated.', endsAt: Date.now() + 60_000 });
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="previous">Page action</button>';
  document.getElementById('previous')!.focus();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
});
afterEach(() => { barrier?.destroy(); vi.useRealTimers(); });

describe('recoverable barrier', () => {
  it('renders hostile strings as text and preserves focus on repeated renders', () => {
    barrier = mountBarrier(document, { override: async () => {}, end: async () => {} });
    const view = { ...blocked(), reason: '<script data-injected>bad()</script><img onerror=bad()>' };
    barrier.render(view);
    const end = shadow().querySelectorAll('button')[1]!; end.focus();
    barrier.render(view);
    expect(shadow().querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(shadow().activeElement).toBe(end);
    expect(shadow().querySelector('.reason')!.textContent).toBe(view.reason);
    expect(shadow().querySelector('script, img')).toBeNull();
    expect(document.body.style.overflow).toBe('hidden');
    barrier.render({ phase: 'idle' });
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement?.id).toBe('previous');
  });

  it('traps Tab and restores page focus after an override', async () => {
    const override = vi.fn(async () => {});
    barrier = mountBarrier(document, { override, end: async () => {} }); barrier.render(blocked());
    const buttons = shadow().querySelectorAll<HTMLButtonElement>('.actions button'); buttons[1]!.focus();
    buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, composed: true, cancelable: true }));
    expect(shadow().activeElement).toBe(buttons[0]);
    buttons[0]!.click(); await vi.advanceTimersByTimeAsync(0);
    expect(override).toHaveBeenCalledOnce(); expect(shadow().querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement?.id).toBe('previous');
  });

  it('releases at expiry even if the worker never responds', async () => {
    barrier = mountBarrier(document, { override: async () => {}, end: async () => {} });
    barrier.render({ ...blocked(), endsAt: Date.now() + 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.body.style.overflow).toBe(''); expect(shadow().querySelector('[role="dialog"]')).toBeNull();
  });

  it('does not extend the checking deadline on duplicate renders', async () => {
    barrier = mountBarrier(document, { override: async () => {}, end: async () => {} });
    barrier.render({ phase: 'checking' }); await vi.advanceTimersByTimeAsync(MODEL_MESSAGE_TIMEOUT_MS - 2_000);
    barrier.render({ phase: 'checking' }); await vi.advanceTimersByTimeAsync(2_000);
    expect(shadow().textContent).toContain('could not check'); expect(document.body.style.overflow).toBe('');
  });

  it('retains retry and end controls after a failed override', async () => {
    barrier = mountBarrier(document, { override: async () => { throw new Error('secret'); }, end: async () => {} });
    barrier.render(blocked()); shadow().querySelector<HTMLButtonElement>('.actions button')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(shadow().querySelector('[role="alert"]')!.textContent).toContain('Try again');
    expect(shadow().textContent).not.toContain('secret');
    expect([...shadow().querySelectorAll<HTMLButtonElement>('.actions button')].every((b) => !b.disabled)).toBe(true);
  });

  it('releases locally after an end-session messaging failure', async () => {
    barrier = mountBarrier(document, { override: async () => {}, end: async () => { throw new Error('offline'); } });
    barrier.render(blocked()); shadow().querySelectorAll<HTMLButtonElement>('.actions button')[1]!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(shadow().querySelector('[role="dialog"]')).toBeNull(); expect(document.body.style.overflow).toBe('');
    expect(shadow().textContent).toContain('page is available');
  });

  it('ignores a late override after the displayed state changes', async () => {
    let resolve!: () => void;
    barrier = mountBarrier(document, { override: () => new Promise<void>((done) => { resolve = done; }), end: async () => {} });
    barrier.render(blocked()); shadow().querySelector<HTMLButtonElement>('.actions button')!.click();
    barrier.render({ ...blocked(), goal: 'A different page and goal' }); resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(shadow().querySelector('[role="dialog"]')).not.toBeNull();
  });
});
