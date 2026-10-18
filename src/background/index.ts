import { createController } from './controller.ts';
import { classify, checkReady } from '../ai/classify.ts';
import { createStore } from '../session/store.ts';

interface ChromeApi {
  storage: Parameters<typeof createStore>[0];
  runtime: {
    onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (reply: unknown) => void) => boolean | void): void };
  };
  webNavigation: {
    onCommitted: { addListener(listener: (details: NavigationDetails) => void): void };
    onHistoryStateUpdated: { addListener(listener: (details: NavigationDetails) => void): void };
    onReferenceFragmentUpdated: { addListener(listener: (details: NavigationDetails) => void): void };
  };
  tabs: {
    get(tabId: number): Promise<{ id?: number; url?: string; active?: boolean }>;
    query(query: { url?: string[]; active?: boolean; lastFocusedWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  scripting: {
    executeScript(options: { target: { tabId: number }; files: string[] }): Promise<unknown>;
  };
  alarms: {
    create(name: string, info: { when: number }): void;
    clear(name: string): Promise<boolean>;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
}

interface NavigationDetails {
  tabId: number;
  frameId: number;
  url: string;
  documentId?: string;
  timeStamp?: number;
}

declare const chrome: ChromeApi;

const store = createStore(chrome.storage);
const controller = createController({ chrome, store, classify, checkReady });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void controller.handleMessage(message as Parameters<typeof controller.handleMessage>[0], sender as Parameters<typeof controller.handleMessage>[1])
    .then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'LockIn could not handle this request.' }));
  return true;
});

const onNavigation = (details: NavigationDetails): void => { void controller.handleNavigation(details); };
chrome.webNavigation.onCommitted.addListener(onNavigation);
chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onNavigation);
chrome.tabs.onRemoved.addListener((tabId) => { void controller.handleTabRemoved(tabId); });
chrome.alarms.onAlarm.addListener((alarm) => { void controller.handleAlarm(alarm.name); });
