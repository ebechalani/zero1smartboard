/**
 * Serial Monitor tab: shows what the sketch prints with `Serial.print` and
 * lets the student type text back to the sketch, like the Arduino IDE. In
 * Python mode its texts speak of the program and print() (`setWords`).
 */

export type LineEnding = 'none' | 'newline' | 'cr' | 'both';

/** Characters appended to the typed text for each line-ending choice. */
export const LINE_ENDING_SUFFIX: Readonly<Record<LineEnding, string>> = {
  none: '',
  newline: '\n',
  cr: '\r',
  both: '\r\n',
};

const LINE_ENDING_LABELS: Readonly<Record<LineEnding, string>> = {
  none: 'No line ending',
  newline: 'Newline',
  cr: 'Carriage return',
  both: 'Both NL & CR',
};

/** Default number of lines kept in the output area. */
export const DEFAULT_MAX_LINES = 5000;

/**
 * The texts that name what prints and what reads the typed text: the sketch (Code and Blocks
 * mode), the program (Python mode, docs/PYTHON.md §7.9).
 */
export interface SerialWords {
  /** The hint while nothing is printed; `{ code }` parts are shown as code. */
  hint: readonly (string | { code: string })[];
  /** The send box's placeholder and `aria-label`. */
  placeholder: string;
  inputLabel: string;
  /** The Send button's `aria-label`. */
  sendLabel: string;
}

/** Code and Blocks mode: the Arduino sketch prints and reads. */
export const SKETCH_SERIAL_WORDS: SerialWords = {
  hint: ['Nothing printed yet. Put ', { code: 'Serial.begin(9600);' }, ' in ', { code: 'setup()' }, ' and use ', { code: 'Serial.println("Hello");' }, ' to see text here.'],
  placeholder: 'Type text to send to the sketch and press Enter',
  inputLabel: 'Text to send to the sketch',
  sendLabel: 'Send text to the sketch',
};

export interface SerialMonitorOptions {
  /** Called with the text to inject into the sketch's RX buffer (line ending included). */
  onSend(text: string): void;
  maxLines?: number;
}

export interface SerialMonitor {
  /** Append text printed by the sketch (may contain several or partial lines). */
  append(text: string): void;
  /** Insert a dim divider, used when the sketch is restarted. */
  addDivider(label: string): void;
  clear(): void;
  /** Update the "9600 baud" label (display only). */
  setBaud(baud: number): void;
  setLineEnding(ending: LineEnding): void;
  getLineEnding(): LineEnding;
  /**
   * Force Newline (the choice is disabled, `title` says why), or give the choice back with the
   * student's own setting (null). Python's input() reads one line (docs/PYTHON.md §7.9).
   */
  forceNewline(title: string | null): void;
  /** The hint and the send box's texts of the current mode (default SKETCH_SERIAL_WORDS). */
  setWords(words: SerialWords): void;
  /** Send whatever is in the input box (same as pressing Enter). */
  send(): void;
  /** Whole output as plain text, lines joined with '\n'. */
  getText(): string;
  /** Number of line elements currently shown (including the line being written). */
  lineCount(): number;
  focusInput(): void;
}

/** Append the selected line ending to typed text. */
export function applyLineEnding(text: string, ending: LineEnding): string {
  return text + LINE_ENDING_SUFFIX[ending];
}

/** Baud rate from the first `Serial.begin(N)` in the sketch (display only; 9600 when absent). */
export function detectBaud(source: string): number {
  const match = /Serial\s*\.\s*begin\s*\(\s*(\d+)/.exec(source);
  return match ? Number(match[1]) : 9600;
}

/**
 * Mount the serial monitor into `container`.
 */
export function createSerialMonitor(container: HTMLElement, options: SerialMonitorOptions): SerialMonitor {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const lineEndingOptions = (Object.keys(LINE_ENDING_LABELS) as LineEnding[])
    .map((k) => `<option value="${k}"${k === 'newline' ? ' selected' : ''}>${LINE_ENDING_LABELS[k]}</option>`)
    .join('');

  container.classList.add('z1-serial');
  container.innerHTML = `
    <div class="z1-serial-toolbar">
      <label class="z1-check"><input type="checkbox" data-role="autoscroll" checked /> Autoscroll</label>
      <button type="button" class="z1-btn z1-btn-small" data-role="clear" aria-label="Clear serial output">Clear</button>
      <span class="z1-serial-baud" data-role="baud" aria-live="polite">9600 baud</span>
    </div>
    <div class="z1-serial-output" data-role="output" role="log" aria-live="polite" aria-label="Serial output" tabindex="0">
      <div class="z1-serial-hint" data-role="hint"></div>
    </div>
    <form class="z1-serial-input" data-role="form">
      <input type="text" data-role="input" autocomplete="off" spellcheck="false" />
      <select data-role="ending" aria-label="Line ending">${lineEndingOptions}</select>
      <button type="submit" class="z1-btn z1-btn-small" data-role="send">Send</button>
    </form>
  `;

  const output = must<HTMLElement>(container, 'output');
  const hint = must<HTMLElement>(container, 'hint');
  const autoscroll = must<HTMLInputElement>(container, 'autoscroll');
  const baudLabel = must<HTMLElement>(container, 'baud');
  const input = must<HTMLInputElement>(container, 'input');
  const endingSelect = must<HTMLSelectElement>(container, 'ending');
  const form = must<HTMLFormElement>(container, 'form');
  const sendButton = must<HTMLButtonElement>(container, 'send');

  function setWords(words: SerialWords): void {
    hint.replaceChildren(
      ...words.hint.map((part) => {
        if (typeof part === 'string') return part;
        const code = document.createElement('code');
        code.textContent = part.code;
        return code;
      }),
    );
    input.placeholder = words.placeholder;
    input.setAttribute('aria-label', words.inputLabel);
    sendButton.setAttribute('aria-label', words.sendLabel);
  }
  setWords(SKETCH_SERIAL_WORDS);

  /** The student's own line-ending choice while Newline is forced (null: not forced). */
  let ownEnding: LineEnding | null = null;

  /** The line currently being written (sketch output without a newline yet). */
  let current = newLine();
  output.appendChild(current);

  function newLine(): HTMLElement {
    const line = document.createElement('div');
    line.className = 'z1-serial-line';
    return line;
  }

  function trim(): void {
    while (output.childElementCount > maxLines + 1) {
      // +1: the hint element is a child too.
      const first = output.firstElementChild;
      if (!first) break;
      if (first === hint) {
        const second = first.nextElementSibling;
        if (!second) break;
        second.remove();
      } else {
        first.remove();
      }
    }
  }

  function scrollToBottom(): void {
    if (autoscroll.checked) output.scrollTop = output.scrollHeight;
  }

  function insertBeforeCurrent(el: HTMLElement): void {
    output.insertBefore(el, current);
    hint.hidden = true;
    trim();
    scrollToBottom();
  }

  function send(): void {
    const text = input.value;
    const ending = endingSelect.value as LineEnding;
    const echo = document.createElement('div');
    echo.className = 'z1-serial-line z1-serial-sent';
    echo.textContent = `› ${text}`;
    insertBeforeCurrent(echo);
    input.value = '';
    options.onSend(applyLineEnding(text, ending));
    input.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  must<HTMLButtonElement>(container, 'clear').addEventListener('click', () => api.clear());

  const api: SerialMonitor = {
    append(text) {
      if (text.length === 0) return;
      hint.hidden = true;
      const parts = text.replace(/\r/g, '').split('\n');
      current.appendChild(document.createTextNode(parts[0]));
      for (let i = 1; i < parts.length; i++) {
        current = newLine();
        current.textContent = parts[i];
        output.appendChild(current);
      }
      trim();
      scrollToBottom();
    },
    addDivider(label) {
      const divider = document.createElement('div');
      divider.className = 'z1-serial-line z1-serial-divider';
      divider.textContent = `— ${label} —`;
      // Keep dividers on their own line even if the sketch stopped mid-line.
      if (current.textContent !== '') {
        current = newLine();
        output.appendChild(current);
      }
      insertBeforeCurrent(divider);
    },
    clear() {
      for (const child of Array.from(output.children)) {
        if (child !== hint) child.remove();
      }
      current = newLine();
      output.appendChild(current);
      hint.hidden = false;
    },
    setBaud(baud) {
      baudLabel.textContent = `${baud} baud`;
    },
    setLineEnding(ending) {
      if (ownEnding !== null) ownEnding = ending;
      else endingSelect.value = ending;
    },
    getLineEnding: () => endingSelect.value as LineEnding,
    forceNewline(title) {
      if (title !== null) {
        if (ownEnding === null) ownEnding = endingSelect.value as LineEnding;
        endingSelect.value = 'newline';
        endingSelect.disabled = true;
        endingSelect.title = title;
      } else if (ownEnding !== null) {
        endingSelect.value = ownEnding;
        ownEnding = null;
        endingSelect.disabled = false;
        endingSelect.removeAttribute('title');
      }
    },
    setWords,
    send,
    getText() {
      return Array.from(output.querySelectorAll<HTMLElement>('.z1-serial-line'))
        .map((line) => line.textContent ?? '')
        .join('\n');
    },
    lineCount: () => output.querySelectorAll('.z1-serial-line').length,
    focusInput: () => input.focus(),
  };
  return api;
}

function must<T extends Element>(root: HTMLElement, role: string): T {
  const el = root.querySelector<T>(`[data-role="${role}"]`);
  if (!el) throw new Error(`serial monitor: missing element "${role}"`);
  return el;
}
