/**
 * Settings ▾ → About: who made the ZERO1 Smart Board and this simulator, and the rights.
 * "Upload to board" ships open-source software under its own licences (the GPL-3.0 AVR
 * compiler, the Arduino core and libraries): the dialog links to their notices
 * (public/THIRD_PARTY_NOTICES.md), as the GPL requires. In the teacher's review frame
 * (a sandbox without popups, and no Upload there) the address is plain text.
 */

export interface AboutDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

export const ABOUT_TEXT = {
  title: 'About the ZERO1 Simulator',
  product: 'ZERO1 Smart Board Simulator',
  rights: '© 2026 ZERO1 Education. All rights reserved.',
  board: 'The ZERO1 Smart Board was created by Wissam Daccache.',
  simulator: 'The simulator was made by Eddy Bachaalany.',
  notices: 'Upload to board uses open-source software (the AVR compiler, the Arduino core and libraries) under their own licences:',
  noticesLink: 'licences and source code',
  noticesPlain: 'see THIRD_PARTY_NOTICES.md on the simulator site',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Create the About `<dialog>` (closed) and append it to `parent` (the app root). */
export function createAboutDialog(parent: HTMLElement, options: { noticesUrl?: string; links?: boolean } = {}): AboutDialog {
  const dialog = el('dialog', 'z1-dialog z1-about');
  dialog.setAttribute('aria-labelledby', 'z1-about-title');
  const form = el('form', 'z1-dialog-form');
  form.noValidate = true;
  const title = el('h2', undefined, ABOUT_TEXT.title);
  title.id = 'z1-about-title';
  const product = el('p', 'z1-about-product', ABOUT_TEXT.product);
  const rights = el('p', 'z1-about-rights', ABOUT_TEXT.rights);
  const credits = el('ul', 'z1-about-credits');
  credits.append(el('li', undefined, ABOUT_TEXT.board), el('li', undefined, ABOUT_TEXT.simulator));
  const notices = el('p', 'z1-about-notices', `${ABOUT_TEXT.notices} `);
  if (options.links === false) {
    notices.append(`${ABOUT_TEXT.noticesPlain}.`);
  } else {
    const link = el('a', undefined, ABOUT_TEXT.noticesLink);
    link.href = options.noticesUrl ?? 'THIRD_PARTY_NOTICES.md';
    link.target = '_blank';
    link.rel = 'noopener';
    notices.append(link, '.');
  }
  const actions = el('div', 'z1-dialog-actions');
  actions.appendChild(el('span', 'z1-spacer'));
  const close = el('button', 'z1-btn z1-btn-primary', 'Close');
  close.type = 'button';
  close.dataset.action = 'close';
  actions.appendChild(close);
  form.append(title, product, rights, credits, notices, actions);
  dialog.appendChild(form);
  form.addEventListener('submit', (e) => e.preventDefault());
  close.addEventListener('click', () => dialog.close());
  parent.appendChild(dialog);

  return {
    open() {
      if (!dialog.open) dialog.showModal();
      close.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
