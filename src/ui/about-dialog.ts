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
  title: 'ZERO1 Smart Board Simulator',
  tagline: 'ICT & Robotics for STEAM Education',
  description: 'Write, simulate and upload Arduino, Blocks and Python programs for the ZERO1 Smart Board, directly in the browser.',
  credits: [
    ['Hardware design', 'Wissam Daccache'],
    ['Software development', 'Eddy Bachaalany'],
  ],
  rights: '© 2026 ZERO1 Education. All rights reserved.',
  notices:
    'This software includes open-source components, including the GNU AVR toolchain and the Arduino core libraries, distributed under their respective licences.',
  noticesLink: 'View third-party licences',
  noticesPlain: 'Third-party licences: THIRD_PARTY_NOTICES.md on the simulator site.',
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

  // Brand mark, product name and tagline
  const head = el('header', 'z1-about-head');
  const logo = el('span', 'z1-logo z1-about-logo', 'Z1');
  logo.setAttribute('aria-hidden', 'true');
  const names = el('div');
  const title = el('h2', 'z1-about-title', ABOUT_TEXT.title);
  title.id = 'z1-about-title';
  names.append(title, el('p', 'z1-about-tagline', ABOUT_TEXT.tagline));
  head.append(logo, names);
  const description = el('p', 'z1-about-description', ABOUT_TEXT.description);

  // Credits: role and name side by side
  const credits = el('dl', 'z1-about-credits');
  for (const [role, name] of ABOUT_TEXT.credits) credits.append(el('dt', undefined, role), el('dd', undefined, name));

  // Rights and the open-source notice, as a quiet footer
  const legal = el('div', 'z1-about-legal');
  const rights = el('p', 'z1-about-rights', ABOUT_TEXT.rights);
  const notices = el('p', 'z1-about-notices', `${ABOUT_TEXT.notices} `);
  if (options.links === false) {
    notices.append(ABOUT_TEXT.noticesPlain);
  } else {
    const link = el('a', undefined, ABOUT_TEXT.noticesLink);
    link.href = options.noticesUrl ?? 'THIRD_PARTY_NOTICES.md';
    link.target = '_blank';
    link.rel = 'noopener';
    notices.append(link);
  }
  legal.append(rights, notices);

  const actions = el('div', 'z1-dialog-actions');
  actions.appendChild(el('span', 'z1-spacer'));
  const close = el('button', 'z1-btn z1-btn-primary', 'Close');
  close.type = 'button';
  close.dataset.action = 'close';
  actions.appendChild(close);
  form.append(head, description, credits, legal, actions);
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
