// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { extractSnapshot, isSupportedUrl, pageKey } from '../src/content/extract.ts';

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
describe('bounded page snapshots', () => {
  it('keeps query/fragment identity local and excludes private or hidden DOM', () => {
    document.title = 'Stripe tutorial';
    document.body.innerHTML = '<main><p>Useful billing guide</p><nav>Navigation noise</nav><p hidden>hidden secret</p><input value="password"/><textarea>private note</textarea><div contenteditable>draft message</div><script>secret()</script><div data-lockin-ui>LockIn private goal</div></main>';
    const result = extractSnapshot(document, 'https://www.youtube.com/watch?v=secret#private');
    expect(result.modelUrl).toBe('www.youtube.com/watch');
    expect(result.pageKey).toContain('?v=secret#private');
    expect(result.text).toBe('Useful billing guide');
  });
  it('caps fields and traversal even with oversized content', () => {
    document.title = 't'.repeat(400);
    document.head.insertAdjacentHTML('beforeend', '<meta name="description" content="' + 'd'.repeat(500) + '">');
    document.body.innerHTML = '<main><p>' + 'x'.repeat(2_000) + '</p></main>';
    const result = extractSnapshot(document, 'https://www.reddit.com/' + 'a'.repeat(600));
    expect(result.title).toHaveLength(200); expect(result.description).toHaveLength(300);
    expect(result.text).toHaveLength(1_500); expect(result.modelUrl).toHaveLength(500);
    document.body.innerHTML = '<main>' + '<span></span>'.repeat(501) + '<p>too far</p></main>';
    expect(extractSnapshot(document, 'https://www.reddit.com/').text).not.toContain('too far');
  });
  it('rejects lookalike hosts and removes URL credentials from page identity', () => {
    expect(isSupportedUrl('https://www.youtube.com.attacker.example/', ['www.youtube.com'])).toBe(false);
    expect(isSupportedUrl('http://www.youtube.com/', ['www.youtube.com'])).toBe(false);
    expect(pageKey('https://user:password@www.youtube.com/watch?v=1')).toBe('https://www.youtube.com/watch?v=1');
  });
});
