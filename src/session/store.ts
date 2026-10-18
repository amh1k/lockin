import { SUPPORTED_HOSTS } from '../config.ts';
import type { Preferences, SessionState, StateStore } from '../shared/types.ts';
import { expire, validPreferences, validSessionState } from './state.ts';

const SESSION_KEY = 'lockin.sessionState';
const PREFERENCES_KEY = 'lockin.preferences';
const DEFAULT_PREFERENCES: Preferences = { hosts: [...SUPPORTED_HOSTS], durationMinutes: 25 };

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface ChromeStorageLike {
  session: StorageAreaLike;
  local: StorageAreaLike;
}

export interface LockInStore extends StateStore {
  readPreferences(): Promise<Preferences>;
  writePreferences(preferences: Preferences): Promise<void>;
}

/** Keep session data in memory-backed Chrome storage across worker restarts. */
export function createStore(chromeStorage: ChromeStorageLike, clock: () => number = Date.now): LockInStore {
  let accessPromise: Promise<void> | undefined;
  const ensureTrustedAccess = (): Promise<void> => {
    accessPromise ??= Promise.all([
      chromeStorage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      chromeStorage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    ]).then(() => undefined);
    return accessPromise;
  };

  async function read(): Promise<SessionState> {
    await ensureTrustedAccess();
    const stored = (await chromeStorage.session.get(SESSION_KEY))[SESSION_KEY];
    if (stored === undefined) return { session: null, overrides: [] };
    if (!validSessionState(stored)) {
      await chromeStorage.session.remove(SESSION_KEY);
      return { session: null, overrides: [] };
    }
    const current = expire(stored, clock());
    if (!current.session) {
      await chromeStorage.session.remove(SESSION_KEY);
      return { session: null, overrides: [] };
    }
    return current;
  }

  async function write(state: SessionState): Promise<void> {
    await ensureTrustedAccess();
    if (!validSessionState(state)) throw new Error('Invalid session state.');
    const current = expire(state, clock());
    if (!current.session) {
      await chromeStorage.session.remove(SESSION_KEY);
      return;
    }
    await chromeStorage.session.set({ [SESSION_KEY]: current });
  }

  async function readPreferences(): Promise<Preferences> {
    await ensureTrustedAccess();
    const stored = (await chromeStorage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY];
    if (stored === undefined) return { ...DEFAULT_PREFERENCES, hosts: [...DEFAULT_PREFERENCES.hosts] };
    if (!validPreferences(stored)) {
      await chromeStorage.local.remove(PREFERENCES_KEY);
      return { ...DEFAULT_PREFERENCES, hosts: [...DEFAULT_PREFERENCES.hosts] };
    }
    return stored;
  }

  async function writePreferences(preferences: Preferences): Promise<void> {
    await ensureTrustedAccess();
    if (!validPreferences(preferences)) throw new Error('Invalid focus preferences.');
    await chromeStorage.local.set({ [PREFERENCES_KEY]: preferences });
  }

  return { read, write, readPreferences, writePreferences };
}
