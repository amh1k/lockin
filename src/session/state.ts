import { LIMITS, SUPPORTED_HOSTS } from '../config.ts';
import type { AIResult, Decision, Session, SessionState, SupportedHost } from '../shared/types.ts';

function validHosts(value: unknown): value is SupportedHost[] {
  return Array.isArray(value) && value.length > 0 &&
    value.every(host => SUPPORTED_HOSTS.includes(host as SupportedHost));
}

function validGoal(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= LIMITS.goalMin &&
    value.trim().length <= LIMITS.goalMax;
}

function validDuration(value: unknown): value is 25 | 50 {
  return value === 25 || value === 50;
}

/** Exact local page identity, including query and fragment but never credentials. */
export function normalizePageKey(value: string, enabledHosts: readonly SupportedHost[]): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || !enabledHosts.includes(url.hostname as SupportedHost)) {
    throw new Error('Page is not on an enabled supported site.');
  }
  url.username = '';
  url.password = '';
  return url.href;
}

export function startSession(
  goal: string,
  durationMinutes: 25 | 50,
  hosts: SupportedHost[],
  now: number,
): Session {
  if (!validGoal(goal)) throw new Error('Focus goal must contain 10–300 characters.');
  if (!validDuration(durationMinutes)) throw new Error('Duration must be 25 or 50 minutes.');
  if (!validHosts(hosts)) throw new Error('Select at least one supported site.');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid session start time.');
  const endsAt = now + durationMinutes * 60_000;
  if (!Number.isSafeInteger(endsAt)) throw new Error('Invalid session end time.');
  return {
    id: crypto.randomUUID(),
    goal: goal.trim(),
    startedAt: now,
    endsAt,
    hosts: [...new Set(hosts)],
  };
}

export function expire(state: SessionState, now: number): SessionState {
  if (!state.session || now >= state.session.endsAt) return { session: null, overrides: [] };
  return state;
}

export function addOverride(state: SessionState, pageKey: string): SessionState {
  if (!state.session) throw new Error('No active focus session.');
  const key = normalizePageKey(pageKey, state.session.hosts);
  if (state.overrides.includes(key)) return state;
  if (state.overrides.length >= LIMITS.overrides) throw new Error(`Session allows at most ${LIMITS.overrides} page overrides.`);
  return { session: state.session, overrides: [...state.overrides, key] };
}

export function decide(
  session: Session | null,
  pageKey: string,
  overrides: string[],
  result: AIResult,
  now: number,
): Decision {
  if (!session || now >= session.endsAt) {
    return { action: 'allow', source: 'inactive', reason: 'No active focus session.' };
  }
  let key: string;
  try {
    key = normalizePageKey(pageKey, session.hosts);
  } catch {
    return { action: 'allow', source: 'unavailable', reason: 'This page is outside the active supported sites.' };
  }
  if (overrides.includes(key)) {
    return { action: 'allow', source: 'override', reason: 'This page is allowed for the rest of the session.' };
  }
  if (result.status === 'unavailable') {
    return { action: 'allow', source: 'unavailable', reason: `Relevance check unavailable (${result.error}).` };
  }
  if (result.label === 'uncertain') {
    return { action: 'allow', source: 'uncertain', reason: result.reason };
  }
  return { action: result.label === 'distracting' ? 'block' : 'allow', source: 'model', reason: result.reason };
}

/** Validate saved data because extension storage can be edited or left by older builds. */
export function validSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null || !('session' in value) || !('overrides' in value)) return false;
  const { session, overrides } = value;
  if (!Array.isArray(overrides) || overrides.length > LIMITS.overrides) return false;
  if (session === null) return overrides.length === 0;
  if (typeof session !== 'object' || !session) return false;
  if (!('id' in session) || typeof session.id !== 'string' || !session.id ||
      !('goal' in session) || !validGoal(session.goal) || session.goal !== session.goal.trim() ||
      !('startedAt' in session) || typeof session.startedAt !== 'number' || !Number.isSafeInteger(session.startedAt) ||
      !('endsAt' in session) || typeof session.endsAt !== 'number' || !Number.isSafeInteger(session.endsAt) ||
      !('hosts' in session) || !validHosts(session.hosts)) return false;
  const duration = (session.endsAt as number) - (session.startedAt as number);
  if (session.startedAt < 0 || ![25 * 60_000, 50 * 60_000].includes(duration)) return false;
  const hosts = session.hosts as SupportedHost[];
  if (new Set(hosts).size !== hosts.length) return false;
  return overrides.every(key => {
    if (typeof key !== 'string') return false;
    try { return normalizePageKey(key, hosts) === key; } catch { return false; }
  }) && new Set(overrides).size === overrides.length;
}

export function validPreferences(value: unknown): value is { hosts: SupportedHost[]; durationMinutes: 25 | 50 } {
  if (typeof value !== 'object' || value === null || !('hosts' in value) || !('durationMinutes' in value)) return false;
  return validHosts(value.hosts) && new Set(value.hosts).size === value.hosts.length &&
    validDuration(value.durationMinutes);
}
