import { MODEL_MESSAGE_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from '../config.ts';
export type BarrierPhase = 'idle' | 'checking' | 'blocked' | 'uncertain' | 'unavailable';

export interface BarrierView {
  phase: BarrierPhase;
  goal?: string;
  reason?: string;
  endsAt?: number;
}

export interface BarrierActions {
  override(): Promise<void>;
  end(): Promise<void>;
}

export interface Barrier {
  render(view: BarrierView): void;
  destroy(): void;
}

const CHECKING_TIMEOUT_MS = MODEL_MESSAGE_TIMEOUT_MS;
const ACTION_TIMEOUT_MS = COMMAND_TIMEOUT_MS;
const instances = new WeakMap<Document, Barrier>();

const styles = `
  :host { all: initial; color: #f8fafc; font: 14px/1.5 system-ui, sans-serif; }
  *, *::before, *::after { box-sizing: border-box; }
  .status { position: fixed; z-index: 2147483647; top: 16px; right: 16px; max-width: min(360px, calc(100vw - 32px)); padding: 12px 16px; border: 1px solid #354539; border-radius: 12px; background: #101713; color: #f8fafc; box-shadow: 0 8px 32px #0008; }
  .backdrop { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 24px; background: #080f0de8; }
  .dialog { width: min(480px, 100%); max-height: calc(100vh - 48px); overflow: auto; padding: 28px; border: 1px solid #354539; border-radius: 20px; background: #101713; color: #f8fafc; box-shadow: 0 24px 80px #000b; }
  .brand { margin-bottom: 24px; color: #bef264; font-size: 12px; font-weight: 800; letter-spacing: .15em; }
  .caption { color: #99ad9e; font-size: 12px; }
  .status { display: flex; align-items: center; gap: 12px; }
  .dismiss { min-height: 28px; min-width: 28px; padding: 0; background: transparent; color: #a7b6ac; font-size: 20px; }
  h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.2; }
  p { margin: 8px 0 18px; color: #cbd5e1; overflow-wrap: anywhere; }
  .goal { color: #f8fafc; font-weight: 600; }
  .reason { padding: 12px; border-radius: 10px; background: #19241c; }
  .error { min-height: 1.5em; color: #fca5a5; }
  .actions { display: grid; gap: 10px; }
  button { min-height: 44px; padding: 10px 14px; border: 0; border-radius: 10px; background: #bef264; color: #17200a; font: inherit; font-weight: 700; cursor: pointer; }
  button.secondary { border: 1px solid #64748b; background: transparent; color: #f8fafc; }
  button:focus-visible { outline: 3px solid #bef264; outline-offset: 3px; }
  button:disabled { cursor: wait; opacity: .65; }
  @media (prefers-reduced-motion: no-preference) { .dialog { animation: enter .16s ease-out; } @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } }
`;

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function mountBarrier(document: Document, actions: BarrierActions): Barrier {
  const existing = instances.get(document);
  if (existing) return existing;

  const host = document.createElement('div');
  host.id = 'lockin-overlay';
  host.setAttribute('data-lockin-ui', '');
  const root = host.attachShadow({ mode: 'open' });
  const style = element(document, 'style');
  style.textContent = styles;
  root.append(style);

  let previousFocus: HTMLElement | null = null;
  const body = document.body;
  const html = document.documentElement;
  let oldBodyOverflow = '';
  let oldHtmlOverflow = '';
  let phase: BarrierPhase = 'idle';
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let errorNode: HTMLElement | undefined;
  let overrideButton: HTMLButtonElement | undefined;
  let endButton: HTMLButtonElement | undefined;
  let mediaHandler: ((event: Event) => void) | undefined;
  let destroyed = false;
  let revision = 0;
  let lastViewKey = '';

  (body ?? html).append(host);

  const clearTimers = (): void => {
    if (checkTimer !== undefined) clearTimeout(checkTimer);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    checkTimer = undefined;
    expiryTimer = undefined;
  };

  const restorePage = (): void => {
    document.removeEventListener('focusin', onFocusIn, true);
    if (mediaHandler) document.removeEventListener('play', mediaHandler, true);
    mediaHandler = undefined;
    if (body) body.style.overflow = oldBodyOverflow;
    html.style.overflow = oldHtmlOverflow;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };

  const release = (next: 'idle' | 'unavailable' = 'idle'): void => {
    revision += 1;
    lastViewKey = '';
    clearTimers();
    if (phase === 'blocked') restorePage();
    phase = next;
    renderStatus(next === 'unavailable' ? 'LockIn could not check this page. The page is available.' : '');
  };

  const renderStatus = (message: string): void => {
    root.querySelector('.surface')?.remove();
    if (!message) return;
    const status = element(document, 'div', 'surface status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const text = element(document, 'span');
    text.textContent = message;
    status.append(text);
    if (phase !== 'checking') {
      const close = element(document, 'button', 'dismiss');
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Dismiss LockIn status');
      close.addEventListener('click', () => status.remove());
      status.append(close);
    }
    root.append(status);
  };

  const focusables = (): HTMLButtonElement[] => [
    ...(overrideButton ? [overrideButton] : []),
    ...(endButton ? [endButton] : []),
  ].filter((button) => !button.disabled);

  function onFocusIn(event: FocusEvent): void {
    if (phase !== 'blocked' || root.contains(event.composedPath()[0] as Node)) return;
    (focusables()[0] ?? root.querySelector<HTMLElement>('.dialog'))?.focus({ preventScroll: true });
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (phase !== 'blocked') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = focusables();
    if (!buttons.length) { event.preventDefault(); root.querySelector<HTMLElement>('.dialog')?.focus(); return; }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && root.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && root.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  const keydownHandler: EventListener = (event) => onKeyDown(event as KeyboardEvent);

  const boundedAction = async (action: () => Promise<void>, ending = false): Promise<void> => {
    const actionRevision = revision;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), ACTION_TIMEOUT_MS);
        }),
      ]);
      if (!destroyed && revision === actionRevision) release('idle');
    } catch {
      if (destroyed || revision !== actionRevision) return;
      if (ending) { release('unavailable'); return; }
      if (errorNode && !destroyed) errorNode.textContent = 'Could not update the focus session. Try again or end the session.';
      if (overrideButton) overrideButton.disabled = false;
      if (endButton) endButton.disabled = false;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const renderBlocked = (view: BarrierView): void => {
    const wasBlocked = phase === 'blocked';
    const focusedEnd = root.activeElement === endButton;
    const focusedOverride = root.activeElement === overrideButton;
    root.querySelector('.surface')?.remove();
    const backdrop = element(document, 'div', 'surface backdrop');
    const dialog = element(document, 'section', 'dialog');
    dialog.tabIndex = -1;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'lockin-title');
    dialog.setAttribute('aria-describedby', 'lockin-reason');

    const brand = element(document, 'div', 'brand');
    brand.textContent = 'LOCKIN / STAY WITH YOUR GOAL';
    const heading = element(document, 'h1');
    heading.id = 'lockin-title';
    heading.textContent = 'This page can wait';
    const goal = element(document, 'p', 'goal');
    goal.textContent = view.goal ? `Your focus goal: ${view.goal}` : 'Your focus session is active.';
    const reason = element(document, 'p', 'reason');
    reason.id = 'lockin-reason';
    reason.textContent = view.reason || 'This page looks unrelated to your current goal.';
    const error = element(document, 'p', 'error');
    error.setAttribute('role', 'alert');
    error.setAttribute('aria-live', 'assertive');
    errorNode = error;

    const buttons = element(document, 'div', 'actions');
    overrideButton = element(document, 'button');
    overrideButton.type = 'button';
    overrideButton.textContent = 'Allow this page for this session';
    overrideButton.addEventListener('click', () => {
      overrideButton!.disabled = true;
      void boundedAction(actions.override);
    });
    endButton = element(document, 'button', 'secondary');
    endButton.type = 'button';
    endButton.textContent = 'End focus session';
    endButton.addEventListener('click', () => {
      endButton!.disabled = true;
      void boundedAction(actions.end, true);
    });
    buttons.append(overrideButton, endButton);
    const caption = element(document, 'p', 'caption');
    caption.textContent = 'Gemma thinks this page may be a distraction. You’re in control.';
    dialog.append(brand, heading, caption, goal, reason, error, buttons);
    backdrop.append(dialog);
    root.append(backdrop);

    if (!wasBlocked) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      oldBodyOverflow = body?.style.overflow ?? '';
      oldHtmlOverflow = html.style.overflow;
      if (body) body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      document.addEventListener('focusin', onFocusIn, true);
      root.addEventListener('keydown', keydownHandler);
      for (const media of document.querySelectorAll('video, audio')) {
        try { (media as HTMLMediaElement).pause(); } catch { /* best effort */ }
      }
      mediaHandler = (event: Event): void => {
        const target = event.target;
        if (target instanceof HTMLMediaElement) {
          try { target.pause(); } catch { /* best effort */ }
        }
      };
      document.addEventListener('play', mediaHandler, true);
    }
    phase = 'blocked';
    if (!wasBlocked || focusedOverride) overrideButton.focus({ preventScroll: true });
    else if (focusedEnd) endButton.focus({ preventScroll: true });
  };

  const barrier: Barrier = {
    render(view): void {
      if (destroyed) return;
      const viewKey = JSON.stringify(view);
      if (viewKey === lastViewKey) return;
      lastViewKey = viewKey;
      revision += 1;
      clearTimers();
      if (view.phase === 'blocked') {
        if (!Number.isFinite(view.endsAt) || (view.endsAt as number) <= Date.now()) {
          release('unavailable');
          return;
        }
        renderBlocked(view);
        const remaining = (view.endsAt as number) - Date.now();
        expiryTimer = setTimeout(() => release('idle'), remaining);
        return;
      }
      if (phase === 'blocked') restorePage();
      phase = view.phase;
      if (view.phase === 'checking') {
        renderStatus('Checking relevance with local Gemma. This can take up to 5 minutes; the page stays available.');
        checkTimer = setTimeout(() => release('unavailable'), CHECKING_TIMEOUT_MS);
      } else if (view.phase === 'uncertain') {
        renderStatus('LockIn is unsure about this page. It remains available.');
      } else if (view.phase === 'unavailable') {
        renderStatus('LockIn could not check this page. The page is available.');
      } else {
        renderStatus('');
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      revision += 1;
      clearTimers();
      if (phase === 'blocked') restorePage();
      root.removeEventListener('keydown', keydownHandler);
      host.remove();
      instances.delete(document);
    },
  };

  instances.set(document, barrier);
  return barrier;
}
