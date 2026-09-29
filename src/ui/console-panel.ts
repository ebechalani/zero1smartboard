/**
 * Console panel under the tabs: transpiler errors/warnings, runtime messages
 * and status lines. Entries with a source line jump the editor to that line
 * (the sketch, or the Python program for `source: 'python'`, docs/PYTHON.md §7.10).
 */
import type { ConsoleMessage } from '../types';

export interface ConsolePanelOptions {
  /** Called when the user clicks a message that carries a source line (with the message's `source`). */
  onJumpToLine(line: number, source?: ConsoleMessage['source']): void;
  /** Oldest entries are dropped beyond this count (default 500). */
  maxEntries?: number;
}

export interface ConsolePanel {
  push(message: ConsoleMessage): void;
  clear(): void;
  /** One-line status shown in the panel header ("Running", "Stopped"…). */
  setStatus(text: string): void;
  /** Number of entries currently shown. */
  count(): number;
}

const DEFAULT_MAX_ENTRIES = 500;

/**
 * Mount the console into `container`.
 */
export function createConsolePanel(container: HTMLElement, options: ConsolePanelOptions): ConsolePanel {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  container.classList.add('z1-console');
  container.innerHTML = `
    <div class="z1-console-header">
      <h2 class="z1-panel-title">Console</h2>
      <span class="z1-console-status" data-role="status" role="status" aria-live="polite">Ready</span>
      <button type="button" class="z1-btn z1-btn-small" data-role="clear" aria-label="Clear console">Clear</button>
    </div>
    <div class="z1-console-list" data-role="list" role="log" aria-label="Console messages"></div>
  `;
  const list = container.querySelector<HTMLElement>('[data-role="list"]')!;
  const status = container.querySelector<HTMLElement>('[data-role="status"]')!;
  container.querySelector<HTMLButtonElement>('[data-role="clear"]')!.addEventListener('click', () => api.clear());

  const api: ConsolePanel = {
    push(message) {
      const entry = document.createElement('div');
      entry.className = 'z1-console-entry';
      entry.dataset.level = message.level;

      const badge = document.createElement('span');
      badge.className = 'z1-console-level';
      badge.textContent = message.level === 'warn' ? 'warning' : message.level;
      entry.appendChild(badge);

      if (message.line !== undefined) {
        const line = message.line;
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'z1-console-line';
        jump.textContent = `line ${line}`;
        jump.setAttribute('aria-label', `Go to line ${line} in the editor`);
        jump.addEventListener('click', () => options.onJumpToLine(line, message.source));
        entry.appendChild(jump);
        entry.classList.add('is-clickable');
        entry.addEventListener('click', (e) => {
          if (e.target !== jump) options.onJumpToLine(line, message.source);
        });
      }

      const text = document.createElement('span');
      text.className = 'z1-console-text';
      text.textContent = message.text;
      entry.appendChild(text);

      list.appendChild(entry);
      while (list.childElementCount > maxEntries) list.firstElementChild?.remove();
      list.scrollTop = list.scrollHeight;
    },
    clear() {
      list.replaceChildren();
    },
    setStatus(text) {
      if (status.textContent !== text) status.textContent = text;
    },
    count: () => list.childElementCount,
  };
  return api;
}
