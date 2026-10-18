import { SUPPORTED_HOSTS } from '../config.ts';
import { checkReady as defaultCheckReady } from '../ai/classify.ts';
import { addOverride, decide, expire, normalizePageKey, startSession } from '../session/state.ts';
import type { LockInStore } from '../session/store.ts';
import type { AIResult, Command, CommandReply, Correlation, EvaluationReply, SessionState, Snapshot, SupportedHost } from '../shared/types.ts';

const GENERATIONS_KEY = 'lockin.generations';
const MAX_MESSAGE_BYTES = 16_000;
const NAVIGATION_SETTLE_MS = 700;
const TITLE_RESAMPLE_MS = 1_300;

interface Sender {
  tab?: { id?: number; url?: string };
  url?: string;
  frameId?: number;
  documentId?: string;
}

interface NavigationDetails {
  tabId: number;
  frameId: number;
  url: string;
  documentId?: string;
  timeStamp?: number;
}

interface GenerationEntry {
  generation: number;
  url: string;
  documentId: string;
}

interface ChromeLike {
  storage: {
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(values: Record<string, unknown>): Promise<void>;
    };
  };
  alarms: { create(name: string, info: { when: number }): void; clear(name: string): Promise<boolean> };
  tabs: {
    get(tabId: number): Promise<{ id?: number; url?: string; active?: boolean }>;
    query(query: { url?: string[]; active?: boolean; lastFocusedWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  scripting: { executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown> };
}

type Classifier = (goal: string, snapshot: Snapshot, signal?: AbortSignal) => Promise<AIResult>;

export interface ControllerDependencies {
  chrome: ChromeLike;
  store: LockInStore;
  classify: Classifier;
  clock?: () => number;
  checkReady?: () => Promise<{ ready: boolean; error?: string }>;
}

export interface Controller {
  handleMessage(message: Command, sender: Sender): Promise<CommandReply>;
  handleNavigation(details: NavigationDetails): Promise<void>;
  handleAlarm(name: string): Promise<void>;
  handleTabRemoved(tabId: number): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asReply<T extends Command['type']>(ok: true, data: Extract<CommandReply<T>, { ok: true }>['data']): CommandReply<T>;
function asReply<T extends Command['type']>(ok: false, error: string): CommandReply<T>;
function asReply(ok: boolean, value: unknown): CommandReply {
  return ok ? { ok: true, data: value } as CommandReply : { ok: false, error: String(value) };
}

function validSnapshot(value: unknown): value is Snapshot {
  if (!isRecord(value)) return false;
  return ['pageKey', 'modelUrl', 'title', 'description', 'text'].every((key) => typeof value[key] === 'string') &&
    (value.pageKey as string).length <= 2_048 && (value.modelUrl as string).length <= 500 &&
    (value.title as string).length <= 200 && (value.description as string).length <= 300 && (value.text as string).length <= 1_500;
}

function supportedHost(url: string): SupportedHost | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.port || !SUPPORTED_HOSTS.includes(parsed.hostname as SupportedHost)) return null;
    return parsed.hostname as SupportedHost;
  } catch {
    return null;
  }
}

function extensionSender(sender: Sender): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://');
}

export function createController(deps: ControllerDependencies): Controller {
  const now = deps.clock ?? Date.now;
  const ready = deps.checkReady ?? defaultCheckReady;
  let mutationQueue: Promise<void> = Promise.resolve();
  let inferenceActive = false;
  const aborts = new Map<string, AbortController>();
  const navTimers = new Map<number, ReturnType<typeof setTimeout>>();

  async function readGenerations(): Promise<Record<string, GenerationEntry>> {
    const value = (await deps.chrome.storage.session.get(GENERATIONS_KEY))[GENERATIONS_KEY];
    return isRecord(value) ? value as Record<string, GenerationEntry> : {};
  }

  async function getOrCreateGeneration(tabId: number, url: string, documentId: string): Promise<number> {
    const generations = await readGenerations();
    const previous = generations[String(tabId)];
    if (previous?.url === url && previous.documentId === documentId) return previous.generation;
    const generation = (previous?.generation ?? 0) + 1;
    generations[String(tabId)] = { generation, url, documentId };
    await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
    return generation;
  }

  async function mutate(operation: () => Promise<void>): Promise<void> {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    await next;
  }

  async function broadcast(state: SessionState): Promise<void> {
    const tabs = await deps.chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://www.reddit.com/*'] });
    await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [
      deps.chrome.tabs.sendMessage(tab.id, { type: 'SESSION_CHANGED', state }).catch(() => undefined),
    ]));
  }

  async function senderContext(sender: Sender): Promise<{ tabId: number; url: string; documentId: string; generation: number } | null> {
    const tabId = sender.tab?.id;
    const url = sender.url ?? sender.tab?.url;
    const documentId = sender.documentId;
    if (tabId === undefined || sender.frameId !== 0 || !url || !documentId || !supportedHost(url)) return null;
    const generation = await getOrCreateGeneration(tabId, url, documentId);
    return { tabId, url, documentId, generation };
  }

  async function isCurrent(context: { tabId: number; url: string; documentId: string; generation: number }, sessionId: string): Promise<boolean> {
    const state = expire(await deps.store.read(), now());
    if (!state.session || state.session.id !== sessionId) return false;
    const entry = (await readGenerations())[String(context.tabId)];
    if (!entry || entry.generation !== context.generation || entry.documentId !== context.documentId || entry.url !== context.url) return false;
    try {
      const tab = await deps.chrome.tabs.get(context.tabId);
      if (tab.active !== true || tab.url !== context.url) return false;
      const foreground = await deps.chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return foreground.some((candidate) => candidate.id === context.tabId);
    } catch {
      return false;
    }
  }

  async function deliver(context: { tabId: number }, reply: EvaluationReply): Promise<void> {
    try { await deps.chrome.tabs.sendMessage(context.tabId, { type: 'EVALUATION_RESULT', reply }); } catch { /* lost content context fails open locally */ }
  }

  async function evaluate(context: { tabId: number; url: string; documentId: string; generation: number }, message: Extract<Command, { type: 'EVALUATE' }>, state: SessionState): Promise<void> {
    const session = state.session;
    if (!session) return;
    const controller = new AbortController();
    const requestId = message.requestId;
    const abortKey = `${context.tabId}:${requestId}`;
    aborts.set(abortKey, controller);
    let ownsInference = false;
    const correlation: Correlation = { sessionId: session.id, tabId: context.tabId, documentId: context.documentId, generation: message.generation, requestId };
    const unavailable: AIResult = { status: 'unavailable', error: 'busy', durationMs: 0 };
    try {
      if (inferenceActive) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        if (!await isCurrent(context, session.id) || inferenceActive) {
          await deliver(context, { correlation, pageKey: message.snapshot.pageKey, decision: decide(session, message.snapshot.pageKey, state.overrides, unavailable, now()), endsAt: session.endsAt });
          return;
        }
      }
      if (!await isCurrent(context, session.id)) return;
      inferenceActive = true;
      ownsInference = true;
      const result = await deps.classify(session.goal, message.snapshot, controller.signal);
      if (!await isCurrent(context, session.id)) return;
      const latest = await deps.store.read();
      const decision = decide(latest.session, message.snapshot.pageKey, latest.overrides, result, now());
      await deliver(context, { correlation, pageKey: message.snapshot.pageKey, decision, endsAt: session.endsAt });
    } catch {
      if (await isCurrent(context, session.id)) {
        const result: AIResult = { status: 'unavailable', error: 'network', durationMs: 0 };
        await deliver(context, { correlation, pageKey: message.snapshot.pageKey, decision: decide(session, message.snapshot.pageKey, state.overrides, result, now()), endsAt: session.endsAt });
      }
    } finally {
      aborts.delete(abortKey);
      if (ownsInference) inferenceActive = false;
    }
  }

  async function handleMessage(message: Command, sender: Sender): Promise<CommandReply> {
    if (!isRecord(message) || JSON.stringify(message).length > MAX_MESSAGE_BYTES) return asReply(false, 'Invalid or oversized message.');
    const fromExtension = extensionSender(sender);
    if (message.type === 'GET_STATE') {
      const state = expire(await deps.store.read(), now());
      let generation: number | null = null;
      const context = await senderContext(sender);
      if (context) generation = context.generation;
      return asReply(true, { state, generation });
    }
    if (message.type === 'CHECK_READY') {
      if (!fromExtension) return asReply(false, 'This command is only available in LockIn.');
      return asReply(true, await ready());
    }
    if (message.type === 'START_SESSION') {
      if (!fromExtension) return asReply(false, 'This command is only available in LockIn.');
      let result: CommandReply;
      await mutate(async () => {
        if ((await deps.store.read()).session) { result = asReply(false, 'End the active session before starting another.'); return; }
        const readiness = await ready();
        if (!readiness.ready) { result = asReply(false, `Local Gemma is not ready (${readiness.error ?? 'unavailable'}).`); return; }
        const session = startSession(message.goal, message.durationMinutes, message.hosts, now());
        const state = { session, overrides: [] };
        await deps.store.write(state);
        deps.chrome.alarms.create('lockin.session-expiry', { when: session.endsAt });
        await broadcast(state);
        const tabs = await deps.chrome.tabs.query({ url: session.hosts.map((host) => `https://${host}/*`) });
        await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [
          deps.chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => undefined),
        ]));
        result = asReply(true, { state });
      });
      return result!;
    }
    if (message.type === 'END_SESSION') {
      if (!fromExtension && !await senderContext(sender)) return asReply(false, 'This page cannot end the focus session.');
      let state: SessionState = { session: null, overrides: [] };
      await mutate(async () => {
        for (const abort of aborts.values()) abort.abort();
        await deps.store.write(state);
        await deps.chrome.alarms.clear('lockin.session-expiry');
        await broadcast(state);
      });
      return asReply(true, { state });
    }
    if (message.type === 'OVERRIDE_PAGE') {
      const context = await senderContext(sender);
      if (!context || context.generation !== message.generation) return asReply(false, 'This page is no longer current.');
      let state: SessionState = { session: null, overrides: [] };
      let error: string | undefined;
      await mutate(async () => {
        state = await deps.store.read();
        if (!state.session) { error = 'No active focus session.'; return; }
        let ownKey: string;
        try { ownKey = normalizePageKey(context.url, state.session.hosts); } catch { error = 'This page is outside the active sites.'; return; }
        if (message.pageKey !== ownKey) { error = 'Page identity did not match.'; return; }
        try { state = addOverride(state, ownKey); await deps.store.write(state); } catch (failure) { error = failure instanceof Error ? failure.message : 'Could not allow this page.'; }
      });
      if (error) return asReply(false, error);
      const abortKeyPrefix = `${context.tabId}:`;
      for (const [key, abort] of aborts) if (key.startsWith(abortKeyPrefix)) abort.abort();
      await deliver(context, { correlation: { sessionId: state.session!.id, tabId: context.tabId, documentId: context.documentId, generation: message.generation, requestId: 'override' }, pageKey: message.pageKey, decision: { action: 'allow', source: 'override', reason: 'This page is allowed for the rest of the session.' }, endsAt: state.session!.endsAt });
      return asReply(true, { state });
    }
    if (message.type === 'EVALUATE') {
      const context = await senderContext(sender);
      if (!context || context.generation !== message.generation || typeof message.requestId !== 'string' || message.requestId.length > 80 || !validSnapshot(message.snapshot)) return asReply(false, 'Invalid or stale page context.');
      let state = expire(await deps.store.read(), now());
      if (!state.session || !state.session.hosts.includes(supportedHost(context.url)!)) return asReply(false, 'No active session for this site.');
      let ownKey: string;
      try { ownKey = normalizePageKey(context.url, state.session.hosts); } catch { return asReply(false, 'Unsupported page.'); }
      if (message.snapshot.pageKey !== ownKey) return asReply(false, 'Page identity did not match.');
      if (state.overrides.includes(ownKey)) {
        await deliver(context, { correlation: { sessionId: state.session.id, tabId: context.tabId, documentId: context.documentId, generation: message.generation, requestId: message.requestId }, pageKey: ownKey, decision: { action: 'allow', source: 'override', reason: 'This page is allowed for the rest of the session.' }, endsAt: state.session.endsAt });
        return asReply(true, { status: 'accepted' });
      }
      void evaluate(context, message, state);
      return asReply(true, { status: 'accepted' });
    }
    return asReply(false, 'Unknown command.');
  }

  async function handleNavigation(details: NavigationDetails): Promise<void> {
    if (details.frameId !== 0 || !supportedHost(details.url)) return;
    const prior = navTimers.get(details.tabId);
    if (prior !== undefined) clearTimeout(prior);
    for (const [key, abort] of aborts) if (key.startsWith(`${details.tabId}:`)) abort.abort();
    const generations = await readGenerations();
    const old = generations[String(details.tabId)];
    const entry = { generation: (old?.generation ?? 0) + 1, url: details.url, documentId: details.documentId ?? `nav-${details.timeStamp ?? now()}` };
    generations[String(details.tabId)] = entry;
    await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
    const timer = setTimeout(() => {
      navTimers.delete(details.tabId);
      void deps.chrome.tabs.sendMessage(details.tabId, { type: 'RESAMPLE', generation: entry.generation }).catch(() => undefined);
    }, NAVIGATION_SETTLE_MS);
    navTimers.set(details.tabId, timer);
  }

  async function handleAlarm(name: string): Promise<void> {
    if (name !== 'lockin.session-expiry') return;
    let state = expire(await deps.store.read(), now());
    if (state.session) {
      deps.chrome.alarms.create(name, { when: state.session.endsAt });
      return;
    }
    await mutate(async () => {
      for (const abort of aborts.values()) abort.abort();
      await deps.store.write(state);
      await broadcast(state);
    });
  }

  async function handleTabRemoved(tabId: number): Promise<void> {
    const timer = navTimers.get(tabId);
    if (timer !== undefined) clearTimeout(timer);
    navTimers.delete(tabId);
    for (const [key, abort] of aborts) if (key.startsWith(`${tabId}:`)) abort.abort();
    const generations = await readGenerations();
    delete generations[String(tabId)];
    await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
  }

  return { handleMessage, handleNavigation, handleAlarm, handleTabRemoved };
}
