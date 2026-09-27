// @vitest-environment happy-dom
/**
 * Share dialog tests (happy-dom): the link, Copy link and Download .ino with
 * the side effects (clipboard, download) replaced by spies, the Hand in hint
 * that appears when the class platform is configured, and the teachers line.
 * There is no email relay any more (docs/CLASSROOM.md §8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveSession } from '../src/classroom/session-store';
import { HANDIN_HINT, TEACHERS_LINE, createShareDialog, type ShareDialogOptions } from '../src/ui/share-dialog';

const SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(A1, HIGH);\n}\n';
const URL_CODE = 'https://example.org/sim/#code=dm9pZCBzZXR1cCgpIHt9';
/** 26 Sep 2026, 14:32:05 local time: the file name stamp is 0926_143205. */
const NOW = new Date(2026, 8, 26, 14, 32, 5);

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('share dialog', () => {
  function setup(extra: ShareDialogOptions = {}) {
    const spies = {
      copyText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
      toast: vi.fn<(text: string) => void>(),
      download: vi.fn<(fileName: string, text: string) => void>(),
    };
    const dialog = createShareDialog(mount(), { configured: false, ...spies, ...extra });
    const el = dialog.element;
    const q = <T extends HTMLElement>(selector: string): T => el.querySelector<T>(selector)!;
    return {
      dialog,
      spies,
      link: q<HTMLInputElement>('#z1-share-url'),
      status: q<HTMLElement>('[data-role="status"]'),
      hint: q<HTMLElement>('[data-role="handin-hint"]'),
      teachers: q<HTMLElement>('[data-role="teachers"]'),
      click: (action: string) => q<HTMLButtonElement>(`[data-action="${action}"]`).click(),
    };
  }

  const payload = { url: URL_CODE, code: SKETCH, kind: 'code' as const };

  it('is labelled by its heading and shows the link, Copy link, Download .ino and Close only', () => {
    const { dialog, link, teachers } = setup();
    expect(dialog.isOpen()).toBe(false);
    dialog.open(payload);
    expect(dialog.isOpen()).toBe(true);
    const el = dialog.element;
    expect(el.tagName).toBe('DIALOG');
    expect(el.querySelector(`#${el.getAttribute('aria-labelledby')}`)!.textContent).toBe('Share your work');
    expect(el.querySelector('[data-role="intro"]')!.textContent).toBe('Share the link, or keep a copy for the Arduino IDE.');
    expect(link.value).toBe(URL_CODE);
    expect(link.readOnly).toBe(true);
    expect(el.querySelector('label[for="z1-share-url"]')!.textContent).toBe('Link');
    // No email, name or message fields and no Send button: the relay is gone.
    expect(el.querySelectorAll('input[type="email"], textarea, input#z1-share-name')).toHaveLength(0);
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy link', 'Download .ino', 'Close']);
    expect(el.textContent).not.toContain('Send to');
    expect(el.textContent).not.toContain('email relay');
    expect(teachers.textContent).toBe(TEACHERS_LINE);
  });

  it('points to Hand in only when the class platform is configured', () => {
    const off = setup({ configured: false });
    off.dialog.open(payload);
    expect(off.hint.hidden).toBe(true);
    const on = setup({ configured: true });
    on.dialog.open(payload);
    expect(on.hint.hidden).toBe(false);
    expect(on.hint.textContent).toBe(HANDIN_HINT);
    expect(on.hint.querySelector('b')!.textContent).toBe('Hand in');
    expect(on.teachers.textContent).toBe(TEACHERS_LINE);
  });

  it('follows isClassroomConfigured() by default', async () => {
    const { isClassroomConfigured } = await import('../src/classroom/firebase');
    const dialog = createShareDialog(mount());
    expect(dialog.element.querySelector<HTMLElement>('[data-role="handin-hint"]')!.hidden).toBe(!isClassroomConfigured());
  });

  it('copies the link, and asks for Ctrl+C when the clipboard refuses', async () => {
    const { dialog, spies, status, link, click } = setup();
    dialog.open(payload);
    click('copy-link');
    expect(spies.copyText).toHaveBeenCalledWith(URL_CODE);
    await Promise.resolve();
    expect(status.textContent).toBe('Link copied');
    expect(spies.toast).toHaveBeenLastCalledWith('Link copied');

    spies.copyText.mockImplementation(() => Promise.reject(new Error('denied')));
    click('copy-link');
    await Promise.resolve();
    await Promise.resolve();
    expect(status.textContent).toBe('Press Ctrl+C to copy the link');
    expect(document.activeElement).toBe(link);
  });

  it('downloads the sketch as a unique .ino file named after the remembered student name', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { dialog, spies, status, click } = setup();
    dialog.open(payload);
    click('download');
    expect(spies.download).toHaveBeenLastCalledWith('zero1_0926_143205.ino', SKETCH);
    expect(status.textContent).toBe('Downloading zero1_0926_143205.ino');

    saveSession({ v: 2, code: 'BKT4M9', className: '8B', firstName: 'Élise', lastName: 'M', uid: 'u1', lastUsedAt: 0, lastHandinAt: 0 });
    const joined = setup();
    joined.dialog.open(payload);
    joined.click('download');
    expect(joined.spies.download).toHaveBeenLastCalledWith('zero1_Elise_M_0926_143205.ino', SKETCH);
  });

  it('downloads once on a double click (the same name would be saved as "name (1).ino")', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { dialog, spies, status, click } = setup();
    dialog.open(payload);
    click('download');
    click('download');
    expect(spies.download).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('Downloading zero1_0926_143205.ino');
    // A second later the name is new: that download goes ahead.
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    click('download');
    expect(spies.download).toHaveBeenCalledTimes(2);
    expect(spies.download).toHaveBeenLastCalledWith('zero1_0926_143206.ino', SKETCH);
  });

  it('downloads through a link inside the modal dialog by default', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sketch');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const parents: (Element | null)[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      parents.push(this.parentElement);
    });
    const { dialog, click } = setup({ download: undefined });
    dialog.open(payload);
    click('download');
    expect(parents).toHaveLength(1);
    expect(dialog.element.contains(parents[0])).toBe(true);
  });

  it('works without localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { dialog, spies, click } = setup();
    dialog.open(payload);
    click('download');
    expect(spies.download).toHaveBeenCalledTimes(1);
    expect(dialog.isOpen()).toBe(true);
  });

  it('clears the status when opened again, and closes with the Close button', () => {
    const { dialog, status, click } = setup();
    dialog.open(payload);
    click('download');
    expect(status.textContent).not.toBe('');
    click('close');
    expect(dialog.isOpen()).toBe(false);
    dialog.open(payload);
    expect(status.textContent).toBe('');
  });
});
