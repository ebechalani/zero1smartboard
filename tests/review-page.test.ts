// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
/**
 * The review page (docs/CLASSROOM.md §7.3, C): the payload from the hash and from a handoff,
 * expired and broken texts, the iframe with exactly sandbox="allow-scripts" and the review src,
 * the CSP meta of review.html, the handshake (only the frame's z1-review-ready with origin 'null'
 * is answered), the page at the window's height (the frame fills the rest on a phone too),
 * Download .ino and Copy from the payload, and the textContent matrix.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_HANDOFF_PREFIX, encodeReviewPayload, type ReviewPayload } from '../src/share-link';
import { BROKEN_LINK_TEXT, EXPIRED_LINK_TEXT, FRAME_SRC, SANDBOX_TEXT, mountReview, readPayload, type ReviewPage } from '../src/review/page';
import { pythonPlaceholder } from '../src/sketch/placeholder';
import { memoryStorage } from './classroom-fakes';

const AT = new Date(2026, 8, 21, 10, 42).getTime(); // Mon 21 Sep 2026
const NOW = new Date(2026, 8, 26, 14, 0).getTime();
const PAYLOAD: ReviewPayload = {
  v: 1,
  kind: 'blocks',
  code: 'void setup() {}\nvoid loop() {}\n',
  workspaceJson: '{"blocks":{}}',
  python: '',
  who: 'ali.k',
  className: '8B Robotics',
  task: 'Traffic light',
  title: 'My light',
  at: AT,
};

let page: ReviewPage | null = null;
afterEach(() => {
  page?.destroy();
  page = null;
  document.body.innerHTML = '';
  document.title = '';
  vi.restoreAllMocks();
});

function mount(hash: string, options: Partial<Parameters<typeof mountReview>[1]> = {}): { root: HTMLElement; page: ReviewPage } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  page = mountReview(root, { hash, storage: memoryStorage(), now: () => NOW, ...options });
  return { root, page };
}

describe('review page: payload', () => {
  it('reads #review= and renders the banner with textContent', () => {
    const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`);
    expect(root.querySelector('.z1r-who')!.textContent).toBe("ali.k's hand-in · 8B Robotics · Traffic light · My light · Mon 10:42 · Blocks");
    expect(root.querySelector('.z1r-who strong')!.textContent).toBe('ali.k');
    expect(root.querySelector('.z1r-note')!.textContent).toBe(SANDBOX_TEXT);
    expect(document.title).toBe('ali.k – ZERO1 review');
  });

  it('reads a #rid= handoff written by the dashboard (with its creation time)', () => {
    const storage = memoryStorage();
    storage.setItem(`${REVIEW_HANDOFF_PREFIX}AbCdEfGhIjKlMnOp`, `${NOW - 60_000}:${encodeReviewPayload(PAYLOAD)}`);
    const { page } = mount('#rid=AbCdEfGhIjKlMnOp', { storage });
    expect(page.payload?.who).toBe('ali.k');
  });

  it('accepts a bare handoff value too', () => {
    expect(readPayload('#rid=AbCdEfGhIjKlMnOp', { ...memoryStorage(), getItem: () => encodeReviewPayload(PAYLOAD) } as Storage, NOW)).toMatchObject({ payload: { who: 'ali.k' } });
  });

  it('says the link expired for a missing or day-old handoff, and drops old handoffs', () => {
    const storage = memoryStorage();
    storage.setItem(`${REVIEW_HANDOFF_PREFIX}OldOldOldOldOld1`, `${NOW - 2 * 86_400_000}:${encodeReviewPayload(PAYLOAD)}`);
    storage.setItem(`${REVIEW_HANDOFF_PREFIX}NewNewNewNewNew1`, `${NOW - 1000}:${encodeReviewPayload(PAYLOAD)}`);
    const { root } = mount('#rid=OldOldOldOldOld1', { storage });
    expect(root.querySelector('.z1r-error')!.textContent).toBe(EXPIRED_LINK_TEXT);
    expect(root.querySelector('iframe')).toBeNull();
    expect(storage.getItem(`${REVIEW_HANDOFF_PREFIX}OldOldOldOldOld1`)).toBeNull();
    expect(storage.getItem(`${REVIEW_HANDOFF_PREFIX}NewNewNewNewNew1`)).not.toBeNull();
    page!.destroy();
    const missing = mount('#rid=GoneGoneGoneGon1');
    expect(missing.root.querySelector('.z1r-error')!.textContent).toBe(EXPIRED_LINK_TEXT);
  });

  it('says the link is broken for a bad or missing payload', () => {
    for (const hash of ['', '#review=', '#review=!!!', `#review=${encodeReviewPayload({ ...PAYLOAD, v: 2 as 1 })}`, '#rid=short']) {
      const { root } = mount(hash);
      expect(root.querySelector('.z1r-error')!.textContent, hash).toBe(BROKEN_LINK_TEXT);
      expect(document.title).toBe('ZERO1 review');
      page!.destroy();
    }
  });
});

describe('review page: sandbox', () => {
  it('creates the iframe with exactly sandbox="allow-scripts" and the review src', () => {
    const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`);
    const iframe = root.querySelector('iframe')!;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('src')).toBe(FRAME_SRC);
    expect(iframe.getAttribute('src')).toBe('./index.html#review');
    expect(iframe.title).toBe("Simulator running ali.k's hand-in");
  });

  it('review.html carries the frame-src CSP and noindex, and imports only the review entry', () => {
    const html = readFileSync(resolve(process.cwd(), 'review.html'), 'utf8');
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="frame-src 'self'" \/>/);
    expect(html).toMatch(/<meta name="robots" content="noindex" \/>/);
    expect(html).toMatch(/src="\/src\/review\/main\.ts"/);
    const entry = readFileSync(resolve(process.cwd(), 'src/review/main.ts'), 'utf8');
    const pageSource = readFileSync(resolve(process.cwd(), 'src/review/page.ts'), 'utf8');
    for (const source of [entry, pageSource]) {
      expect(source).not.toMatch(/firebase|classroom\//);
    }
  });

  it('answers only the frame\'s z1-review-ready with origin "null"', () => {
    const target = new EventTarget() as unknown as Window;
    const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`, { target });
    const iframe = root.querySelector('iframe')!;
    const posted: unknown[] = [];
    const frameWindow = { postMessage: (msg: unknown, origin: string) => posted.push({ msg, origin }) } as unknown as Window;
    Object.defineProperty(iframe, 'contentWindow', { value: frameWindow, configurable: true });
    const send = (source: unknown, origin: string, data: unknown) => {
      const ev = new Event('message') as MessageEvent;
      Object.defineProperties(ev, { source: { value: source }, origin: { value: origin }, data: { value: data } });
      target.dispatchEvent(ev);
    };
    send(frameWindow, 'https://example.org', { type: 'z1-review-ready' }); // wrong origin
    send({}, 'null', { type: 'z1-review-ready' }); // wrong source
    send(frameWindow, 'null', { type: 'something-else' }); // wrong type
    expect(posted).toEqual([]);
    send(frameWindow, 'null', { type: 'z1-review-ready' });
    expect(posted).toEqual([{ msg: { type: 'z1-review', payload: PAYLOAD }, origin: '*' }]);
  });

  it('the page is the window’s height at every width, so the frame fills the space under the banner', () => {
    // Below 1000 px style.css gives html and body `height: auto`; a root of `height: 100%` then left
    // the frame at an iframe's default 150 px on a phone (measured in Chromium at 390 × 844).
    const style = document.createElement('style');
    style.textContent = ['src/ui/style.css', 'src/review/review.css'].map((f) => readFileSync(resolve(process.cwd(), f), 'utf8')).join('\n');
    document.head.appendChild(style);
    const { happyDOM } = window as unknown as { happyDOM: { setViewport(v: { width: number; height: number }): void } };
    try {
      const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`);
      root.id = 'review';
      for (const width of [390, 1440]) {
        happyDOM.setViewport({ width, height: 844 });
        expect(getComputedStyle(root).height, `${width} px`).toBe('844px');
        expect(getComputedStyle(root.querySelector('.z1r-frame')!).flexGrow, `${width} px`).toBe('1');
      }
      happyDOM.setViewport({ width: 390, height: 844 });
      expect(getComputedStyle(document.body).height).toBe('auto');
    } finally {
      style.remove();
      happyDOM.setViewport({ width: 1024, height: 768 });
    }
  });
});

describe('review page: buttons', () => {
  it('downloads the .ino named after the student and the hand-in time', () => {
    const download = vi.fn();
    const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`, { download });
    const buttons = [...root.querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Download .ino')!.click();
    expect(download).toHaveBeenCalledWith('zero1_ali_k_0921_104200.ino', PAYLOAD.code);
  });

  it('copies the code and reports it', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const { root } = mount(`#review=${encodeReviewPayload(PAYLOAD)}`, { copyText });
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Copy code')!.click();
    expect(copyText).toHaveBeenCalledWith(PAYLOAD.code);
    await Promise.resolve();
    expect(root.querySelector('.z1r-status')!.textContent).toBe('Copied');
  });
});

describe('review page: a Python hand-in (docs/PYTHON.md §8.5)', () => {
  const PY = 'from machine import Pin\nled = Pin(13, Pin.OUT)\nwhile True:\n    led.toggle()\n';
  const PY_PAYLOAD: ReviewPayload = { ...PAYLOAD, kind: 'python', workspaceJson: '', python: PY, task: '', title: '' };
  const buttonTexts = (root: HTMLElement) => [...root.querySelectorAll('.z1r-actions button, .z1r-actions a')].map((b) => b.textContent);
  const buttonNamed = (root: HTMLElement, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;

  it('says "· Python" in the banner and offers Download .py next to Download .ino', () => {
    const download = vi.fn();
    const { root } = mount(`#review=${encodeReviewPayload(PY_PAYLOAD)}`, { download });
    expect(root.querySelector('.z1r-who')!.textContent).toBe("ali.k's hand-in · 8B Robotics · Mon 10:42 · Python");
    expect(document.title).toBe('ali.k – ZERO1 review');
    expect(buttonTexts(root)).toEqual(['Download .py', 'Download .ino', 'Copy code', 'Dashboard']);
    expect(root.querySelector('.z1r-python-errors')).toBeNull();
    buttonNamed(root, 'Download .py').click();
    buttonNamed(root, 'Download .ino').click();
    expect(download.mock.calls).toEqual([
      ['zero1_ali_k_0921_104200.py', PY],
      ['zero1_ali_k_0921_104200.ino', PAYLOAD.code],
    ]);
  });

  it('Copy copies the Python', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const { root } = mount(`#review=${encodeReviewPayload(PY_PAYLOAD)}`, { copyText });
    buttonNamed(root, 'Copy code').click();
    expect(copyText).toHaveBeenCalledWith(PY);
    await Promise.resolve();
    expect(root.querySelector('.z1r-status')!.textContent).toBe('Copied');
  });

  it('a program handed in with errors: the note, and Download .ino disabled with that reason', () => {
    const download = vi.fn();
    const { root } = mount(`#review=${encodeReviewPayload({ ...PY_PAYLOAD, code: pythonPlaceholder(3) })}`, { download });
    expect(root.querySelector('.z1r-python-errors')!.textContent).toBe('Handed in with 3 Python errors');
    const ino = buttonNamed(root, 'Download .ino');
    expect(ino.disabled).toBe(true);
    expect(ino.title).toBe('Handed in with 3 Python errors: there is no sketch to download');
    buttonNamed(root, 'Download .py').click();
    expect(download).toHaveBeenCalledWith('zero1_ali_k_0921_104200.py', PY);
    page!.destroy();
    const one = mount(`#review=${encodeReviewPayload({ ...PY_PAYLOAD, code: pythonPlaceholder(1) })}`);
    expect(one.root.querySelector('.z1r-python-errors')!.textContent).toBe('Handed in with 1 Python error');
  });

  it('a Code hand-in that looks like the placeholder is still a Code hand-in', () => {
    const { root } = mount(`#review=${encodeReviewPayload({ ...PAYLOAD, kind: 'code', workspaceJson: '', code: pythonPlaceholder(2) })}`);
    expect(buttonTexts(root)).toEqual(['Download .ino', 'Copy code', 'Dashboard']);
    expect(buttonNamed(root, 'Download .ino').disabled).toBe(false);
    expect(root.querySelector('.z1r-python-errors')).toBeNull();
  });

  it('a Python link without its program (python absent): Download .py disabled, Copy copies the sketch', () => {
    const copyText = vi.fn().mockResolvedValue(undefined);
    const { python: _dropped, ...older } = PY_PAYLOAD;
    const { root } = mount(`#review=${encodeReviewPayload(older)}`, { copyText });
    expect(buttonNamed(root, 'Download .py').disabled).toBe(true);
    buttonNamed(root, 'Copy code').click();
    expect(copyText).toHaveBeenCalledWith(PAYLOAD.code);
  });

  it('hands the frame the payload with the program', () => {
    const target = new EventTarget() as unknown as Window;
    const { root } = mount(`#review=${encodeReviewPayload(PY_PAYLOAD)}`, { target });
    const iframe = root.querySelector('iframe')!;
    const posted: unknown[] = [];
    const frameWindow = { postMessage: (msg: unknown) => posted.push(msg) } as unknown as Window;
    Object.defineProperty(iframe, 'contentWindow', { value: frameWindow, configurable: true });
    const ev = new Event('message') as MessageEvent;
    Object.defineProperties(ev, { source: { value: frameWindow }, origin: { value: 'null' }, data: { value: { type: 'z1-review-ready' } } });
    target.dispatchEvent(ev);
    expect(posted).toEqual([{ type: 'z1-review', payload: PY_PAYLOAD }]);
  });
});

describe('review page: textContent matrix', () => {
  it.each(['<img src=x onerror=alert(1)>', '</script><b>x</b>'])('renders %s literally', (evil) => {
    const payload: ReviewPayload = { ...PAYLOAD, who: evil, className: evil, task: evil, title: evil };
    const { root } = mount(`#review=${encodeReviewPayload(payload)}`);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.z1r-who')!.textContent).toContain(`${evil}'s hand-in · ${evil} · ${evil} · ${evil}`);
    expect(document.title).toBe(`${evil} – ZERO1 review`);
  });
});
