import type { Command, CommandReply, SessionState, SupportedHost } from '../shared/types.ts';
import { validPreferences } from '../session/state.ts';

interface PopupChrome {
  runtime: { sendMessage(message: Command): Promise<CommandReply> };
  tabs: { query(query: { active: boolean; currentWindow: boolean }): Promise<Array<{ url?: string }>> };
  storage: { local: { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> } };
}

declare const chrome: PopupChrome;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as T;
};

const form = byId<HTMLFormElement>('start-form');
const goal = byId<HTMLTextAreaElement>('goal');
const notice = byId<HTMLDivElement>('notice');
const sessionView = byId<HTMLElement>('session-view');
const startButton = byId<HTMLButtonElement>('start-session');
const endButton = byId<HTMLButtonElement>('end-session');
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let sessionState: SessionState = { session: null, overrides: [] };
const PREFERENCES_KEY = 'lockin.preferences';

function showNotice(message: string, error = false): void {
  notice.textContent = message;
  notice.className = `notice visible${error ? ' error' : ''}`;
}

function hideNotice(): void { notice.className = 'notice'; notice.textContent = ''; }

function updateCountdown(endsAt: number): void {
  const remaining = Math.max(0, endsAt - Date.now());
  const totalSeconds = Math.ceil(remaining / 1_000);
  byId('countdown').textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  if (remaining === 0) {
    sessionState = { session: null, overrides: [] };
    renderState(sessionState);
  }
}

function renderState(state: SessionState): void {
  sessionState = state;
  const active = state.session !== null && state.session.endsAt > Date.now();
  sessionView.hidden = !active;
  form.hidden = active;
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  if (!active || !state.session) return;
  byId('session-goal').textContent = state.session.goal;
  byId('session-sites').textContent = `Watching ${state.session.hosts.map((host) => host === 'www.youtube.com' ? 'YouTube' : 'Reddit').join(' and ')}`;
  updateCountdown(state.session.endsAt);
  countdownTimer = setInterval(() => updateCountdown(state.session!.endsAt), 1_000);
}

async function send<T extends Command['type']>(command: Extract<Command, { type: T }>): Promise<CommandReply<T>> {
  return await chrome.runtime.sendMessage(command) as CommandReply<T>;
}

async function currentTabStatus(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url;
    let supported = false;
    try {
      const parsed = new URL(url ?? '');
      supported = parsed.protocol === 'https:' && (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'www.reddit.com');
      if (supported && sessionState.session) {
        byId('site-status').textContent = sessionState.session.hosts.includes(parsed.hostname as SupportedHost)
          ? 'This tab is in your focus session.'
          : 'This site is not selected for the active session.';
        return;
      }
    } catch { /* no web page is selected */ }
    byId('site-status').textContent = supported ? 'Supported tab. Start a session to check its pages.' : 'Current tab is outside the supported sites.';
  } catch {
    byId('site-status').textContent = 'Open YouTube or Reddit to use page checks.';
  }
}

byId<HTMLButtonElement>('check-model').addEventListener('click', async () => {
  showNotice('Checking local Gemma…');
  try {
    const result = await send({ type: 'CHECK_READY' });
    if (!result.ok) { showNotice(result.error, true); return; }
    showNotice(result.data.ready ? 'Gemma is ready. Page text stays on this device.' : `Gemma is not ready (${result.data.error ?? 'unavailable'}). See setup instructions.`, !result.data.ready);
  } catch {
    showNotice('Could not reach the LockIn worker. Reload the extension and try again.', true);
  }
});

goal.addEventListener('input', () => { byId('goal-count').textContent = `${goal.value.length} / 300`; });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideNotice();
  const normalizedGoal = goal.value.trim();
  const hosts = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="host"]:checked')).map((input) => input.value as SupportedHost);
  const duration = Number(form.querySelector<HTMLInputElement>('input[name="duration"]:checked')?.value);
  if (normalizedGoal.length < 10 || normalizedGoal.length > 300) { showNotice('Your focus goal must be 10–300 characters.', true); return; }
  if (!hosts.length) { showNotice('Select YouTube, Reddit, or both.', true); return; }
  startButton.disabled = true;
  startButton.textContent = 'Checking Gemma and starting…';
  let reply: CommandReply<'START_SESSION'>;
  try {
    reply = await send({ type: 'START_SESSION', goal: normalizedGoal, durationMinutes: duration as 25 | 50, hosts });
  } catch {
    startButton.disabled = false;
    startButton.textContent = 'Start focus session →';
    showNotice('Could not reach the LockIn worker. Reload the extension and try again.', true);
    return;
  }
  startButton.disabled = false;
  startButton.textContent = 'Start focus session →';
  if (!reply.ok) { showNotice(reply.error, true); return; }
  try { await chrome.storage.local.set({ [PREFERENCES_KEY]: { hosts, durationMinutes: duration } }); } catch { /* preferences are optional */ }
  renderState(reply.data.state);
  showNotice('Focus session started.');
  void currentTabStatus();
});

endButton.addEventListener('click', async () => {
  endButton.disabled = true;
  let reply: CommandReply<'END_SESSION'>;
  try { reply = await send({ type: 'END_SESSION' }); } catch {
    endButton.disabled = false;
    showNotice('Could not reach the LockIn worker. Try again.', true);
    return;
  }
  endButton.disabled = false;
  if (!reply.ok) { showNotice(reply.error, true); return; }
  renderState(reply.data.state);
  void currentTabStatus();
  showNotice('Focus session ended.');
});

void Promise.all([send({ type: 'GET_STATE' }), currentTabStatus(), chrome.storage.local.get(PREFERENCES_KEY)]).then(([reply, , stored]) => {
  const preferences = stored[PREFERENCES_KEY];
  if (validPreferences(preferences)) {
    for (const input of form.querySelectorAll<HTMLInputElement>('input[name="host"]')) input.checked = preferences.hosts.includes(input.value as SupportedHost);
    const duration = form.querySelector<HTMLInputElement>(`input[name="duration"][value="${preferences.durationMinutes}"]`);
    if (duration) duration.checked = true;
  }
  if (reply.ok) {
    renderState(reply.data.state);
    void currentTabStatus();
  }
}).catch(() => showNotice('Could not reach the LockIn service worker. Reload the extension and try again.', true));
