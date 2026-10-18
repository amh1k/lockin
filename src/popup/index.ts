import type { Command, CommandReply, SessionState, SupportedHost, WorkerMessage } from '../shared/types.ts';
import { validPreferences } from '../session/state.ts';
import { sendCommand } from '../shared/messaging.ts';
import type { CommandRuntime } from '../shared/messaging.ts';

interface PopupChrome {
  runtime: CommandRuntime & {
    getURL(path: string): string;
    onMessage: { addListener(listener: (message: WorkerMessage) => void): void };
  };
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ url?: string }>> };
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> } };
}

declare const chrome: PopupChrome;
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('start-form');
const goal = byId<HTMLTextAreaElement>('goal');
const notice = byId<HTMLDivElement>('notice');
const setup = byId<HTMLDetailsElement>('setup');
const startButton = byId<HTMLButtonElement>('start-session');
const endButton = byId<HTMLButtonElement>('end-session');
const checkButton = byId<HTMLButtonElement>('check-model');
const PREFERENCES_KEY = 'lockin.preferences';
let sessionState: SessionState = { session: null, overrides: [] };
let busy = false;
let initialized = false;
let stateVersion = 0;
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function modelStatus(label: string, state = ''): void {
  const node = byId('model-status');
  node.dataset.state = state;
  node.querySelector('span')!.textContent = label;
}

function showNotice(message: string, error = false): void {
  notice.textContent = message;
  notice.className = `notice visible${error ? ' error' : ''}`;
  if (error) notice.setAttribute('role', 'alert');
  else notice.setAttribute('role', 'status');
}

function errorMessage(error: string): string {
  if (error.includes('missing-model')) return 'Gemma is not downloaded yet. Run ollama pull gemma3:1b, then check again.';
  if (error.includes('busy')) return 'Gemma is checking another page. Give it a moment, then try again.';
  if (error.includes('timeout')) return 'Gemma did not finish within 5 minutes. Check Ollama’s model and hardware, then try again.';
  if (error.includes('network') || error.includes('http')) return 'Could not connect to Ollama. Start it, allow this extension’s origin, then restart Ollama.';
  return error;
}

function validForm(): boolean {
  const length = goal.value.trim().length;
  return length >= 10 && length <= 300 && !!form.querySelector('input[name="host"]:checked') &&
    !!form.querySelector('input[name="duration"]:checked');
}

function updateControls(): void {
  startButton.disabled = !initialized || busy || !validForm();
  endButton.disabled = busy;
  checkButton.disabled = busy || !initialized;
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) control.disabled = busy;
  byId('goal-count').textContent = `${goal.value.length} / 300`;
}

function setBusy(value: boolean): void {
  busy = value;
  startButton.setAttribute('aria-busy', String(value));
  checkButton.setAttribute('aria-busy', String(value));
  updateControls();
}

function updateCountdown(): void {
  const session = sessionState.session;
  if (!session) return;
  const remaining = Math.max(0, session.endsAt - Date.now());
  const seconds = Math.ceil(remaining / 1_000);
  byId('countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  byId<HTMLProgressElement>('session-progress').value = Math.min(100, Math.max(0, 100 * (1 - remaining / (session.endsAt - session.startedAt))));
  if (remaining === 0) {
    renderState({ session: null, overrides: [] });
    showNotice('Session complete. Take a breath — you made time for your goal.');
  }
}

function renderState(state: SessionState): void {
  sessionState = state;
  clearInterval(countdownTimer);
  const active = state.session !== null && state.session.endsAt > Date.now();
  byId('session-view').hidden = !active;
  form.hidden = active;
  if (active && state.session) {
    byId('session-goal').textContent = state.session.goal;
    byId('session-sites').textContent = `Focus sites: ${state.session.hosts.map((host) => host === 'www.youtube.com' ? 'YouTube' : 'Reddit').join(' + ')}`;
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1_000);
  }
  void currentTabStatus();
}

async function send<T extends Command['type']>(command: Extract<Command, { type: T }>): Promise<CommandReply<T>> {
  return sendCommand(chrome.runtime, command);
}

async function currentTabStatus(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = new URL(tab?.url ?? '');
    const host = parsed.hostname as SupportedHost;
    const supported = parsed.protocol === 'https:' && !parsed.port && ['www.youtube.com', 'www.reddit.com'].includes(host);
    byId('site-status').textContent = !supported ? 'Supports YouTube and Reddit. Other sites stay open.'
      : sessionState.session ? sessionState.session.hosts.includes(host) ? 'Focus is on for this site. Unsure results stay open.' : 'This site is outside your selected focus sites.'
        : 'This site is supported. Set a goal to get started.';
  } catch { byId('site-status').textContent = 'Open YouTube or Reddit to try your first session.'; }
}

checkButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  modelStatus('Checking…');
  byId('setup-feedback').textContent = 'Loading and checking local Gemma… This can take up to 5 minutes.';
  try {
    const result = await send({ type: 'CHECK_READY' });
    const ready = result.ok && result.data.ready;
    modelStatus(ready ? 'Gemma ready' : 'Needs setup', ready ? 'ready' : 'error');
    byId('setup-feedback').textContent = ready ? 'Connected. You’re ready to start a focus session.' : errorMessage(result.ok ? result.data.error ?? 'Gemma could not respond.' : result.error);
  } catch { modelStatus('Unavailable', 'error'); byId('setup-feedback').textContent = 'Could not reach LockIn. Reload the extension and refresh this page.'; }
  finally { setBusy(false); }
});

form.addEventListener('input', updateControls);
form.addEventListener('change', updateControls);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !initialized) return;
  if (!validForm()) { showNotice('Write a goal of 10–300 characters and choose at least one site.', true); goal.focus(); return; }
  const hosts = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="host"]:checked')).map((input) => input.value as SupportedHost);
  const duration = Number(form.querySelector<HTMLInputElement>('input[name="duration"]:checked')!.value) as 25 | 50;
  setBusy(true);
  startButton.textContent = 'Checking Gemma… up to 5 min';
  modelStatus('Checking…');
  try {
    const reply = await send({ type: 'START_SESSION', goal: goal.value.trim(), durationMinutes: duration, hosts });
    if (!reply.ok) { modelStatus('Needs attention', 'error'); showNotice(errorMessage(reply.error), true); setup.open = true; return; }
    stateVersion += 1;
    renderState(reply.data.state);
    modelStatus('Gemma ready', 'ready');
    notice.className = 'notice';
    setup.open = false;
    void chrome.storage.local.set({ [PREFERENCES_KEY]: { hosts, durationMinutes: duration } }).catch(() => undefined);
  } catch { modelStatus('Unavailable', 'error'); showNotice('Could not reach LockIn. Reload the extension and try again.', true); }
  finally { setBusy(false); startButton.textContent = 'Start focus session ↗'; if (sessionState.session) endButton.focus(); }
});

endButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  endButton.textContent = 'Ending session…';
  try {
    const reply = await send({ type: 'END_SESSION' });
    if (!reply.ok) { showNotice(reply.error, true); return; }
    stateVersion += 1;
    renderState(reply.data.state);
    showNotice('Session ended. Start again whenever you’re ready.');
  } catch { showNotice('Could not end the session. Try again or wait for it to expire.', true); }
  finally { setBusy(false); endButton.textContent = 'End focus session'; if (!sessionState.session) goal.focus(); }
});

const origin = chrome.runtime.getURL('').replace(/\/$/, '');
byId('extension-origin').textContent = origin;
byId('copy-origin').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(origin); byId('copy-origin').textContent = 'Copied!'; }
  catch { byId('copy-origin').textContent = 'Select and copy the origin above'; }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'SESSION_CHANGED') { stateVersion += 1; renderState(message.state); }
});

async function initialize(): Promise<void> {
  const version = stateVersion;
  const [stateResult, preferencesResult] = await Promise.allSettled([send({ type: 'GET_STATE' }), chrome.storage.local.get(PREFERENCES_KEY)]);
  if (preferencesResult.status === 'fulfilled') {
    const prefs = preferencesResult.value[PREFERENCES_KEY];
    if (validPreferences(prefs)) {
      for (const input of form.querySelectorAll<HTMLInputElement>('input[name="host"]')) input.checked = prefs.hosts.includes(input.value as SupportedHost);
      const duration = form.querySelector<HTMLInputElement>(`input[name="duration"][value="${prefs.durationMinutes}"]`);
      if (duration) duration.checked = true;
    }
  }
  if (stateResult.status === 'fulfilled' && stateResult.value.ok) {
    if (version === stateVersion) renderState(stateResult.value.data.state);
    initialized = true;
  } else {
    showNotice('Could not load LockIn. Reload the extension and reopen this popup.', true);
  }
  updateControls();
}
void initialize();
