/**
 * "Upload to board" where uploading cannot work here (no Web Serial, no compiler on this copy
 * of the site, ...): the header button stays visible and a click opens this short dialog that
 * says why and what to do instead. A hidden button could not be found, and its absence said
 * nothing about the browser being the reason. Every text goes through textContent.
 */
import type { UnsupportedReason, UploadSupport } from '../service';

export interface UnsupportedDialog {
  open(support: UploadSupport): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

/** What to do, per reason (after the reason itself, UNSUPPORTED_TEXT). */
export const UNSUPPORTED_ADVICE: Record<UnsupportedReason, string[]> = {
  'no-serial': [
    'Use Google Chrome or Microsoft Edge on a Windows, Mac or Linux computer, or on a Chromebook.',
    'Phones, tablets, Firefox and Safari cannot send a program to the board.',
  ],
  'insecure-context': ['Open the page from its https:// address.'],
  'no-wasm': ['Turn WebAssembly back on, or use another computer.'],
  'no-module-worker': ['Update Chrome or Edge, then reload this page.'],
  'no-toolchain': ['Open the ZERO1 Simulator from the address your teacher gave you.'],
};

/** The way to the board that works everywhere. */
export const UNSUPPORTED_FALLBACK = 'Meanwhile, Arduino IDE (∞ in the header) gives you the sketch to upload with the Arduino IDE.';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Create the dialog (closed) and append it to `parent` (the app root). */
export function createUnsupportedDialog(parent: HTMLElement): UnsupportedDialog {
  const dialog = el('dialog', 'z1-dialog z1-upload-unsupported');
  dialog.setAttribute('aria-labelledby', 'z1-upload-unsupported-title');
  dialog.setAttribute('aria-describedby', 'z1-upload-unsupported-reason');
  const form = el('form', 'z1-dialog-form');
  form.noValidate = true;
  const title = el('h2', undefined, 'Upload to board');
  title.id = 'z1-upload-unsupported-title';
  const reason = el('p', 'z1-upload-unsupported-reason');
  reason.id = 'z1-upload-unsupported-reason';
  reason.dataset.role = 'reason';
  const advice = el('ul', 'z1-help-list');
  advice.dataset.role = 'advice';
  const fallback = el('p', 'z1-dialog-note', UNSUPPORTED_FALLBACK);
  const actions = el('div', 'z1-dialog-actions');
  actions.appendChild(el('span', 'z1-spacer'));
  const close = el('button', 'z1-btn z1-btn-primary', 'Close');
  close.type = 'button';
  close.dataset.action = 'close';
  actions.appendChild(close);
  form.append(title, reason, advice, fallback, actions);
  dialog.appendChild(form);
  form.addEventListener('submit', (e) => e.preventDefault());
  close.addEventListener('click', () => dialog.close());
  parent.appendChild(dialog);

  return {
    open(support) {
      reason.textContent = support.message;
      advice.replaceChildren(...(support.reason ? UNSUPPORTED_ADVICE[support.reason] : []).map((line) => el('li', undefined, line)));
      advice.hidden = advice.childElementCount === 0;
      if (!dialog.open) dialog.showModal();
      close.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
