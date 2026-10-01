/**
 * The "What works" dialog of the Python tab (docs/PYTHON.md §7.3): the one-page student summary
 * "What works in ZERO1 Python" (§2.15). The content is the translator's (`WHAT_WORKS`,
 * src/python/help.ts, plain text); this file only lays it out, every text through textContent.
 *
 * Loaded only with the Python chunk (src/ui/python-chunk.ts).
 */
import type { HelpBlock, HelpPage } from '../python';

export interface PythonHelpDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBlock(block: HelpBlock): HTMLElement {
  switch (block.type) {
    case 'text':
      return el('p', undefined, block.text);
    case 'code': {
      const pre = el('pre', 'z1-help-code');
      pre.appendChild(el('code', undefined, block.code));
      return pre;
    }
    case 'list': {
      const list = el('ul', 'z1-help-list');
      for (const item of block.items) list.appendChild(el('li', undefined, item));
      return list;
    }
    case 'table': {
      const wrap = el('div', 'z1-help-table');
      const table = el('table');
      const head = el('tr');
      for (const cell of block.head) head.appendChild(el('th', undefined, cell));
      table.appendChild(el('thead')).appendChild(head);
      const body = table.appendChild(el('tbody'));
      for (const row of block.rows) {
        const tr = body.appendChild(el('tr'));
        row.forEach((cell, i) => {
          const td = tr.appendChild(el(i === 0 ? 'th' : 'td', undefined, cell));
          if (i === 0) td.setAttribute('scope', 'row');
        });
      }
      wrap.appendChild(table);
      return wrap;
    }
  }
}

/** Create the "What works" `<dialog>` for `page` and append it to `parent` (the app root). */
export function createPythonHelpDialog(parent: HTMLElement, page: HelpPage): PythonHelpDialog {
  const dialog = el('dialog', 'z1-dialog z1-python-help');
  dialog.setAttribute('aria-labelledby', 'z1-python-help-title');
  const form = el('form', 'z1-dialog-form');
  form.noValidate = true;
  const title = el('h2', undefined, page.title);
  title.id = 'z1-python-help-title';
  const body = el('div', 'z1-help-body');
  body.tabIndex = 0; // the long text scrolls: reachable with the keyboard
  body.setAttribute('role', 'document');
  for (const section of page.sections) {
    const part = body.appendChild(el('section', 'z1-help-section'));
    part.appendChild(el('h3', 'z1-help-heading', section.heading));
    for (const block of section.blocks) part.appendChild(renderBlock(block));
  }
  const actions = el('div', 'z1-dialog-actions');
  actions.appendChild(el('span', 'z1-spacer'));
  const close = el('button', 'z1-btn z1-btn-primary', 'Close');
  close.type = 'button';
  close.dataset.action = 'close';
  actions.appendChild(close);
  form.append(title, body, actions);
  dialog.appendChild(form);

  form.addEventListener('submit', (e) => e.preventDefault());
  close.addEventListener('click', () => dialog.close());
  parent.appendChild(dialog);

  return {
    open() {
      if (!dialog.open) dialog.showModal();
      body.scrollTop = 0;
      body.focus(); // the arrow keys scroll the text, Tab reaches Close
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
