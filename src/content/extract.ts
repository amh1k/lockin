import { LIMITS, SUPPORTED_HOSTS } from '../config.ts';
import type { Snapshot, SupportedHost } from '../shared/types.ts';

const EXCLUDED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'NAV', 'IFRAME', 'OBJECT', 'EMBED',
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
]);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isSupportedUrl(url: string, hosts: SupportedHost[]): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.protocol === 'https:' && parsed.port === '' &&
    hosts.includes(parsed.hostname as SupportedHost);
}

/** Build the exact-page identity retained locally; remove any URL credentials. */
export function pageKey(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    throw new Error('Page URL must be a valid HTTP or HTTPS URL.');
  }
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
}

function isHidden(element: Element, view: Window | null): boolean {
  if (element.hasAttribute('hidden') || element.hasAttribute('inert') ||
      element.getAttribute('aria-hidden')?.toLowerCase() === 'true') return true;
  const inline = (element as HTMLElement).style;
  if (inline && (inline.display === 'none' || inline.visibility === 'hidden' || inline.visibility === 'collapse' || inline.opacity === '0')) {
    return true;
  }
  if (!view) return false;
  try {
    const computed = view.getComputedStyle(element);
    return computed.display === 'none' || computed.visibility === 'hidden' ||
      computed.visibility === 'collapse' || computed.opacity === '0';
  } catch {
    return false;
  }
}

function shouldSkip(element: Element, view: Window | null): boolean {
  if (EXCLUDED_TAGS.has(element.tagName)) return true;
  if (element.getAttribute('role')?.toLowerCase() === 'navigation') return true;
  if (element.hasAttribute('data-lockin-ui') || element.id === 'lockin-overlay' || element.id === 'lockin-dialog') return true;
  const editable = element.getAttribute('contenteditable');
  if (editable !== null && editable.toLowerCase() !== 'false') return true;
  return isHidden(element, view);
}

function renderedText(root: Element, doc: Document): string {
  const view = doc.defaultView;
  const parts: string[] = [];
  let length = 0;
  let visitedElements = 0;
  let visitedNodes = 0;
  let limitReached = false;

  const visit = (node: Node): void => {
    if (length >= LIMITS.text || limitReached || visitedNodes >= LIMITS.traversalElements * 10) return;
    visitedNodes += 1;
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? '';
      if (!text) return;
      const take = text.slice(0, LIMITS.text - length);
      parts.push(take);
      length += take.length;
      return;
    }
    if (node.nodeType === 1) {
      if (visitedElements >= LIMITS.traversalElements) {
        limitReached = true;
        return;
      }
      visitedElements += 1;
      if (shouldSkip(node as Element, view)) return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (length >= LIMITS.text || limitReached || visitedNodes >= LIMITS.traversalElements * 10) break;
    }
  };

  visit(root);
  return parts.join(' ').replace(/\s+/gu, ' ').trim().slice(0, LIMITS.text);
}

export function extractSnapshot(document: Document, url: string): Snapshot {
  if (!isSupportedUrl(url, [...SUPPORTED_HOSTS])) {
    throw new Error('Page URL is outside LockIn supported sites.');
  }
  const parsed = new URL(url);
  const modelUrl = `${parsed.hostname}${parsed.pathname}`.slice(0, LIMITS.modelUrl);
  const description = document.querySelector<HTMLMetaElement>('meta[name="description" i]')?.content ?? '';
  const contentRoot = document.querySelector('main') ?? document.body;

  return {
    pageKey: pageKey(parsed.href),
    modelUrl,
    title: document.title.trim().slice(0, LIMITS.title),
    description: description.trim().slice(0, LIMITS.description),
    text: contentRoot ? renderedText(contentRoot, document) : '',
  };
}
