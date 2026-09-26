// @vitest-environment happy-dom
/**
 * Sketch file names for the Arduino IDE and the .ino download helper.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SKETCH_NAME_LENGTH,
  SKETCH_NAME_PATTERN,
  downloadTextFile,
  sketchFileName,
  sketchName,
} from '../src/ui/sketch-file';

const WHEN = new Date(2026, 8, 6, 9, 5, 7); // 6 Sep 2026, 09:05:07 local time

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('sketch names', () => {
  it('stamps the month, day and time so two downloads never share a name', () => {
    expect(sketchName('', WHEN)).toBe('zero1_0906_090507');
    expect(sketchName('', new Date(2026, 8, 6, 9, 5, 8))).not.toBe(sketchName('', WHEN));
    expect(sketchFileName('', WHEN)).toBe('zero1_0906_090507.ino');
  });

  it('adds the student name reduced to letters, digits and _', () => {
    expect(sketchName('Élise Martin', WHEN)).toBe('zero1_Elise_Martin_0906_090507');
    expect(sketchName("  o'Neil -- 5B ", WHEN)).toBe('zero1_o_Neil_5B_0906_090507');
    expect(sketchName('__x', WHEN)).toBe('zero1_x_0906_090507');
    expect(sketchName('محمد', WHEN)).toBe('zero1_0906_090507'); // no Latin letters left
  });

  it('always gives a name the Arduino IDE and Arduino Cloud accept', () => {
    const names = ['', 'A', 'Élise Martin', 'a'.repeat(80), '0 1 2', 'x/y\\z:*?"<>|', 'Ωmega', ' '.repeat(5)];
    for (const n of names) {
      const name = sketchName(n, WHEN);
      expect(name).toMatch(SKETCH_NAME_PATTERN);
      expect(name.length).toBeLessThanOrEqual(MAX_SKETCH_NAME_LENGTH);
      expect(name).not.toMatch(/__|_$/);
    }
  });
});

describe('downloadTextFile', () => {
  it('clicks a temporary download link inside the container and revokes the URL later', () => {
    vi.useFakeTimers();
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob);
      return 'blob:sketch';
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const clicked: { download: string; href: string; parent: Element | null }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.getAttribute('href') ?? '', parent: this.parentElement });
    });

    downloadTextFile('zero1_0906_090507.ino', 'void setup() {}\n', container);

    expect(clicked).toEqual([{ download: 'zero1_0906_090507.ino', href: 'blob:sketch', parent: container }]);
    expect(container.querySelector('a')).toBeNull(); // removed right after the click
    expect(created[0]?.type).toBe('text/plain');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sketch');
  });
});
