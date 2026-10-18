import { SUPPORTED_HOSTS } from '../config.ts';
import { addOverride, decide, expire, normalizePageKey, startSession } from '../session/state.ts';
import type { LockInStore } from '../session/store.ts';
import type { AIResult, Command, CommandReply, Correlation, EvaluationReply, SessionState, Snapshot, SupportedHost } from '../shared/types.ts';

const GENERATIONS_KEY = 'lockin.generations';
const MAX_MESSAGE_BYTES = 16_000;

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
  runtime?: { id: string; sendMessage(message: unknown): Promise<unknown> };
  webNavigation?: { getFrame(details: { tabId: number; frameId: number }): Promise<{ documentId?: string; url?: string } | null> };
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
  checkReady: () => Promise<{ ready: boolean; error?: string }>;
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
  return sender.tab === undefined && typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://');
}

export function createController(deps: ControllerDependencies): Controller {
  const now = deps.clock ?? Date.now;
  const ready = deps.checkReady;
  let mutationQueue: Promise<void> = Promise.resolve();
  let inferenceActive = false;
  const aborts = new Map<string, AbortController>();
  let generationQueue: Promise<unknown> = Promise.resolve();
  function generationsMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = generationQueue.then(operation, operation);
    generationQueue = next.catch(() => undefined);
    return next;
  }

  async function checkModel() {
    if (inferenceActive) return { ready: false, error: 'busy' };
    inferenceActive = true;
    try { return await ready(); } finally { inferenceActive = false; }
  }

  async function readGenerations(): Promise<Record<string, GenerationEntry>> {
    const value = (await deps.chrome.storage.session.get(GENERATIONS_KEY))[GENERATIONS_KEY];
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => isRecord(entry) &&
      Number.isSafeInteger(entry.generation) && (entry.generation as number) > 0 &&
      typeof entry.url === 'string' && typeof entry.documentId === 'string')) as Record<string, GenerationEntry>;
  }

  async function mutate(operation: () => Promise<void>): Promise<void> {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    await next;
  }

  async function broadcast(state: SessionState): Promise<void> {
    const tabs = await deps.chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://www.reddit.com/*'] }).catch(() => []);
    if (deps.chrome.runtime) await deps.chrome.runtime.sendMessage({ type: 'SESSION_CHANGED', state }).catch(() => undefined);
    await Promise.all(tabs.flatMap((tab) => tab.id === undefined ? [] : [
      deps.chrome.tabs.sendMessage(tab.id, { type: 'SESSION_CHANGED', state }).catch(() => undefined),
    ]));
  }

  async function senderContext(sender: Sender, register = false, inactive = false): Promise<{ tabId: number; url: string; documentId: string; generation: number } | null> {
    const tabId = sender.tab?.id;
    const documentId = sender.documentId;
    if (!Number.isInteger(tabId) || sender.frameId !== 0 || !documentId) return null;
    let url: string;
    try {
      const tab = await deps.chrome.tabs.get(tabId!);
      if (!tab.url || !supportedHost(tab.url)) return null;
      url = tab.url;
      if (deps.chrome.webNavigation) {
        const frame = await deps.chrome.webNavigation.getFrame({ tabId: tabId!, frameId: 0 });
        if (!frame || frame.documentId !== documentId) return null;
      } else if (sender.url !== url) return null;
    } catch { return null; }
    if (inactive) return { tabId: tabId!, url, documentId, generation: 0 };
    return generationsMutation(async () => {
      if (register && !(await deps.store.read()).session) return { tabId: tabId!, url, documentId, generation: 0 };
      const generations = await readGenerations();
      const previous = generations[String(tabId)];
      if (previous?.url === url && previous.documentId === documentId) return { tabId: tabId!, url, documentId, generation: previous.generation };
      if (!register) return null;
      if (previous && previous.documentId !== documentId && !deps.chrome.webNavigation) return null;
      const generation = (previous?.generation ?? 0) + 1;
      generations[String(tabId)] = { generation, url, documentId };
      await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
      return { tabId: tabId!, url, documentId, generation };
    });
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
        if (!await isCurrent(context, session.id)) return;
        if (inferenceActive) {
          await deliver(context, { correlation, pageKey: message.snapshot.pageKey, decision: decide(session, message.snapshot.pageKey, state.overrides, unavailable, now()), endsAt: session.endsAt });
          return;
        }
      }
      inferenceActive = true;
      ownsInference = true;
      if (!await isCurrent(context, session.id) || controller.signal.aborted) return;
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
    const fromExtension = extensionSender(sender) && (!deps.chrome.runtime || sender.url?.startsWith(`chrome-extension://${deps.chrome.runtime.id}/`));
    if (message.type === 'GET_STATE') {
      const state = expire(await deps.store.read(), now());
      let generation: number | null = null;
      const context = await senderContext(sender, true, state.session === null);
      if (!context && !fromExtension) return asReply(false, 'This page cannot access LockIn state.');
      if (context && state.session) generation = context.generation;
      return asReply(true, { state, generation });
    }
    if (message.type === 'CHECK_READY') {
      if (!fromExtension) return asReply(false, 'This command is only available in LockIn.');
      return asReply(true, await checkModel());
    }
    if (message.type === 'START_SESSION') {
      if (!fromExtension) return asReply(false, 'This command is only available in LockIn.');
      let result: CommandReply;
      await mutate(async () => {
        if ((await deps.store.read()).session) { result = asReply(false, 'End the active session before starting another.'); return; }
        const readiness = await checkModel();
        if (!readiness.ready) { result = asReply(false, `Local Gemma is not ready (${readiness.error ?? 'unavailable'}).`); return; }
        const session = startSession(message.goal, message.durationMinutes, message.hosts, now());
        const state = { session, overrides: [] };
        await deps.store.write(state);
        deps.chrome.alarms.create('lockin.session-expiry', { when: session.endsAt });
        await broadcast(state);
        const tabs = await deps.chrome.tabs.query({ url: session.hosts.map((host) => `https://${host}/*`) }).catch(() => []);
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
        await generationsMutation(() => deps.chrome.storage.session.set({ [GENERATIONS_KEY]: {} }));
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
      await broadcast(state);
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
      await evaluate(context, message, state);
      return asReply(true, { status: 'accepted' });
    }
    return asReply(false, 'Unknown command.');
  }

  async function handleNavigation(details: NavigationDetails): Promise<void> {
    if (details.frameId !== 0) return;
    for (const [key, abort] of aborts) if (key.startsWith(`${details.tabId}:`)) abort.abort();
    const entry = await generationsMutation(async () => {
      if (!(await deps.store.read()).session) return null;
      const generations = await readGenerations();
      const old = generations[String(details.tabId)];
      const entry = { generation: (old?.generation ?? 0) + 1, url: details.url, documentId: details.documentId ?? old?.documentId ?? '' };
      generations[String(details.tabId)] = entry;
      await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
      return entry;
    });
    if (entry && supportedHost(details.url)) {
      await deps.chrome.tabs.sendMessage(details.tabId, { type: 'RESAMPLE', generation: entry.generation }).catch(() => undefined);
    }
  }

  async function handleAlarm(name: string): Promise<void> {
    if (name !== 'lockin.session-expiry') return;
    await mutate(async () => {
      const state = expire(await deps.store.read(), now());
      if (state.session) {
        deps.chrome.alarms.create(name, { when: state.session.endsAt });
        return;
      }
      for (const abort of aborts.values()) abort.abort();
      await deps.store.write(state);
      await generationsMutation(() => deps.chrome.storage.session.set({ [GENERATIONS_KEY]: {} }));
      await broadcast(state);
    });
  }

  async function handleTabRemoved(tabId: number): Promise<void> {
    for (const [key, abort] of aborts) if (key.startsWith(`${tabId}:`)) abort.abort();
    await generationsMutation(async () => {
      const generations = await readGenerations();
      delete generations[String(tabId)];
      await deps.chrome.storage.session.set({ [GENERATIONS_KEY]: generations });
    });
  }

  return { handleMessage, handleNavigation, handleAlarm, handleTabRemoved };
}
