/**
 * Share dialog: everything a student needs to hand in their work — the share
 * link (`#code=` / `#blocks=`), a ready-to-send email to the teacher (Gmail,
 * Outlook on the web or the computer's own email app) and the sketch as an
 * `.ino` file for the Arduino IDE.
 *
 * The simulator never sends anything itself: the email opens pre-filled in
 * the student's own mail, where they check it and press Send. The teacher's
 * address and the student's name are remembered in localStorage.
 *
 * The email helpers are pure and exported for the tests.
 */

/** localStorage key of the teacher's email address. */
export const TEACHER_EMAIL_STORAGE_KEY = 'z1.teacherEmail';
/** localStorage key of the student's name (optional, used in the email and the file name). */
export const STUDENT_NAME_STORAGE_KEY = 'z1.studentName';

/** What is being shared: a hand-written sketch or a blocks program. */
export type ShareKind = 'code' | 'blocks';

/** How the email is opened: Gmail or Outlook on the web, or the default mail app (`mailto:`). */
export type EmailProvider = 'gmail' | 'outlook' | 'mailto';

export interface SharePayload {
  /** The `#code=` / `#blocks=` share link. */
  url: string;
  /** The Arduino sketch (in Blocks mode: the sketch generated from the blocks). */
  code: string;
  kind: ShareKind;
}

export interface ShareEmailInput extends SharePayload {
  studentName?: string;
}

export interface ShareEmail {
  subject: string;
  body: string;
}

/** Which parts of the work did not fit in the email link. */
export type ShareTrim = 'none' | 'code' | 'link' | 'all';

export interface FittedEmail extends ShareEmail {
  /** The Gmail / Outlook / mailto: link that opens the email. */
  url: string;
  /** 'code': link only · 'link': code only · 'all': short body, the work must be pasted by hand. */
  trimmed: ShareTrim;
}

/**
 * Longest email link each way of sending may produce. Some desktop mail apps
 * (and Windows when it hands the link over) cut `mailto:` links after about
 * 2000 characters; the Gmail and Outlook web servers refuse URLs much longer
 * than 8 KB. Longer work falls back to fewer parts (see fitShareEmail).
 */
export const MAILTO_URL_BUDGET = 1900;
export const WEBMAIL_URL_BUDGET = 8000;
export const EMAIL_URL_BUDGET: Readonly<Record<EmailProvider, number>> = {
  gmail: WEBMAIL_URL_BUDGET,
  outlook: WEBMAIL_URL_BUDGET,
  mailto: MAILTO_URL_BUDGET,
};

/**
 * A plain email address. Deliberately strict: no spaces and none of
 * `, ; ? & # < > " '`, so a typed address can never add recipients or smuggle
 * extra parameters (`?cc=`, `&bcc=`, `&body=`) into the email link.
 */
const EMAIL_PATTERN = /^[^\s@,;?&#<>"']+@[^\s@,;?&#<>"']+\.[^\s@,;?&#<>"']+$/;
/** Longest address allowed by the mail standards. */
const EMAIL_MAX_LENGTH = 254;
/** Longest student name used in the subject and the signature. */
const NAME_MAX_LENGTH = 60;
/** Longest name part of the .ino file name. */
const FILE_NAME_MAX_LENGTH = 40;

const SEPARATOR = '----------------------------------------';

/** Whether `text` is an email address the dialog accepts (see EMAIL_PATTERN). */
export function isValidEmail(text: string): boolean {
  return text.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(text);
}

/** The name as it appears in the email: single spaces, at most NAME_MAX_LENGTH characters. */
function cleanName(name: string | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim();
}

/** Subject and first lines shared by every version of the email. */
function emailHead(input: ShareEmailInput): { subject: string; greeting: string } {
  const name = cleanName(input.studentName);
  const what = input.kind === 'blocks' ? 'ZERO1 blocks program' : 'ZERO1 sketch';
  return {
    subject: name ? `${what} from ${name}` : what,
    greeting: `Hello,\n\nHere is my ${input.kind === 'blocks' ? 'blocks program' : 'sketch'} for the ZERO1 Smart Board.`,
  };
}

/**
 * The work itself: the simulator link, the Arduino code between separator
 * lines and the student's name. Either part can be left out when it does not
 * fit in an email link; the text then says where to find it.
 */
function emailWork(input: ShareEmailInput, parts: { link: boolean; code: boolean }): string {
  const blocks = input.kind === 'blocks';
  const lines: string[] = [];
  if (parts.link) {
    lines.push('Open it in the simulator:', input.url);
  } else {
    lines.push(
      blocks
        ? 'The link to my blocks was too long for an email, so here is the Arduino code generated from them.'
        : 'The simulator link was too long for an email, so here is the code.',
    );
  }
  lines.push('');
  if (parts.code) {
    lines.push(blocks ? 'Arduino code generated from my blocks:' : 'Arduino code:', SEPARATOR, input.code.replace(/\s+$/, ''), SEPARATOR);
  } else {
    lines.push(
      blocks
        ? 'The Arduino code generated from my blocks was too long for an email: the link shows it in the Code tab.'
        : 'The code was too long for an email: the link above opens it.',
    );
  }
  const name = cleanName(input.studentName);
  if (name) lines.push('', name);
  return lines.join('\n');
}

/** The complete email: greeting, the simulator link, the Arduino code and the student's name. */
export function buildShareEmail(input: ShareEmailInput): ShareEmail {
  const { subject, greeting } = emailHead(input);
  return { subject, body: `${greeting}\n\n${emailWork(input, { link: true, code: true })}` };
}

/**
 * What the student pastes into the short email when even the link and the
 * code alone are too long for an email link (fitShareEmail's 'all' case).
 */
export function shareEmailWorkText(input: ShareEmailInput): string {
  return emailWork(input, { link: true, code: true });
}

/**
 * The link that opens a pre-filled email. Every value is percent-encoded
 * (sketches are full of `& # ? % + =` and may contain any unicode); in a
 * `mailto:` link line breaks are sent as CRLF (`%0D%0A`, RFC 6068) and the
 * two halves of the address are encoded separately around a literal `@`.
 */
export function composeEmailUrl(provider: EmailProvider, to: string, subject: string, body: string): string {
  const enc = encodeURIComponent;
  if (provider === 'gmail') {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
  }
  if (provider === 'outlook') {
    return `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;
  }
  const at = to.lastIndexOf('@');
  const address = at < 0 ? enc(to) : `${enc(to.slice(0, at))}@${enc(to.slice(at + 1))}`;
  const crlf = (text: string): string => enc(text.replace(/\r\n|\r|\n/g, '\r\n'));
  return `mailto:${address}?subject=${crlf(subject)}&body=${crlf(body)}`;
}

/**
 * The longest version of the email whose link stays within `maxLength`:
 * link + code, else the link only, else the code only, else a short body
 * that asks the teacher to read the work pasted below it (the dialog copies
 * shareEmailWorkText() to the clipboard for that).
 */
export function fitShareEmail(
  provider: EmailProvider,
  to: string,
  input: ShareEmailInput,
  maxLength: number = EMAIL_URL_BUDGET[provider],
): FittedEmail {
  const { subject, greeting } = emailHead(input);
  const attempts: [ShareTrim, { link: boolean; code: boolean }][] = [
    ['none', { link: true, code: true }],
    ['code', { link: true, code: false }],
    ['link', { link: false, code: true }],
  ];
  for (const [trimmed, parts] of attempts) {
    const body = `${greeting}\n\n${emailWork(input, parts)}`;
    const url = composeEmailUrl(provider, to, subject, body);
    if (url.length <= maxLength) return { url, subject, body, trimmed };
  }
  const body = `${greeting} It was too long for an email link, so I pasted it below.\n\n`;
  return { url: composeEmailUrl(provider, to, subject, body), subject, body, trimmed: 'all' };
}

/** `zero1_sketch.ino`, or `zero1_<name>.ino` with the name reduced to letters, digits and `_`. */
export function inoFileName(studentName?: string): string {
  const slug = (studentName ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Élise → Elise
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, FILE_NAME_MAX_LENGTH)
    .replace(/_+$/, '');
  return slug ? `zero1_${slug}.ino` : 'zero1_sketch.ino';
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadText(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function saveText(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private mode or quota exceeded: the field simply is not pre-filled next time.
  }
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface ShareDialogOptions {
  /** Open an email link: `_blank` for web mail, `_self` for `mailto:` (default: window.open / location.href). */
  openUrl?(url: string, target: '_blank' | '_self'): void;
  /** Put text on the clipboard (default: navigator.clipboard.writeText). */
  copyText?(text: string): Promise<void>;
  /**
   * Also called with every feedback message. The dialog always shows them in
   * its own status line: a page toast would sit under the modal backdrop.
   */
  toast?(text: string): void;
  /** Save a text file (default: a temporary `<a download>` on a Blob URL). */
  download?(filename: string, text: string): void;
}

export interface ShareDialog {
  /** Show the dialog for this link and sketch. */
  open(payload: SharePayload): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

/** Feedback after an email was opened. */
const SENT_WITH: Record<EmailProvider, string> = {
  gmail: 'Gmail opened in a new tab — check the email, then press Send.',
  outlook: 'Outlook opened in a new tab — check the email, then press Send.',
  mailto:
    'Your email app should open with the email ready — check it, then press Send. Nothing opened? Use Gmail, Outlook or "Copy email text".',
};

/** Added to the feedback when part of the work was left out of the email (see fitShareEmail). */
const TRIM_NOTE: Record<Exclude<ShareTrim, 'all'>, string> = {
  none: '',
  code: ' Your code was too long to include, so the email has the link only (it opens your code).',
  link: ' The link was too long to include, so the email has your code only.',
};

function defaultOpenUrl(url: string, target: '_blank' | '_self'): void {
  if (target === '_self') location.href = url;
  else window.open(url, '_blank', 'noopener');
}

function defaultCopyText(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

/**
 * Create the share `<dialog>` and append it to `parent`.
 */
export function createShareDialog(parent: HTMLElement, options: ShareDialogOptions = {}): ShareDialog {
  const openUrl = options.openUrl ?? defaultOpenUrl;
  const copyText = options.copyText ?? defaultCopyText;

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-share';
  dialog.setAttribute('aria-labelledby', 'z1-share-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-share-title">Share your work</h2>
      <p class="z1-muted">Send it to your teacher, share the link, or keep a copy for the Arduino IDE.</p>

      <div class="z1-setting">
        <label for="z1-share-url">Link</label>
        <div class="z1-share-row">
          <input type="text" id="z1-share-url" readonly spellcheck="false" aria-describedby="z1-share-url-help" />
          <button type="button" class="z1-btn" data-action="copy-link">Copy link</button>
        </div>
        <p class="z1-setting-help" id="z1-share-url-help">Anyone who opens this link sees your work in the simulator.</p>
      </div>

      <fieldset class="z1-share-section">
        <legend>Send to your teacher</legend>
        <div class="z1-share-fields">
          <div class="z1-setting">
            <label for="z1-share-email">Teacher's email</label>
            <input type="email" id="z1-share-email" autocomplete="email" placeholder="teacher@school.edu" required spellcheck="false" aria-describedby="z1-share-email-error z1-share-send-help" />
            <p class="z1-share-error" id="z1-share-email-error" aria-live="polite"></p>
          </div>
          <div class="z1-setting">
            <label for="z1-share-name">Your name (optional)</label>
            <input type="text" id="z1-share-name" autocomplete="name" maxlength="${NAME_MAX_LENGTH}" />
          </div>
        </div>
        <div class="z1-share-buttons">
          <button type="button" class="z1-btn" data-action="send-gmail">Send with Gmail</button>
          <button type="button" class="z1-btn" data-action="send-outlook">Send with Outlook</button>
          <button type="button" class="z1-btn" data-action="send-mailto">Other email app</button>
          <button type="button" class="z1-btn" data-action="copy-email">Copy email text</button>
        </div>
        <p class="z1-setting-help" id="z1-share-send-help">Nothing is sent automatically: this opens a ready-to-send email with your link and your code. Check it, then press Send.</p>
      </fieldset>

      <fieldset class="z1-share-section">
        <legend>Save as a file</legend>
        <div class="z1-share-row">
          <button type="button" class="z1-btn" data-action="download">Download .ino</button>
          <p class="z1-setting-help">Open it in the Arduino IDE, or attach it to an email.</p>
        </div>
      </fieldset>

      <div class="z1-dialog-actions">
        <p class="z1-share-status z1-spacer" data-role="status" role="status" aria-live="polite"></p>
        <button type="button" class="z1-btn" data-action="close">Close</button>
      </div>
    </form>
  `;
  const form = dialog.querySelector('form')!;
  const urlInput = dialog.querySelector<HTMLInputElement>('#z1-share-url')!;
  const emailInput = dialog.querySelector<HTMLInputElement>('#z1-share-email')!;
  const nameInput = dialog.querySelector<HTMLInputElement>('#z1-share-name')!;
  const emailError = dialog.querySelector<HTMLElement>('#z1-share-email-error')!;
  const status = dialog.querySelector<HTMLElement>('[data-role="status"]')!;
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;

  let payload: SharePayload = { url: '', code: '', kind: 'code' };

  const notify = (text: string): void => {
    status.textContent = text;
    options.toast?.(text);
  };

  const setEmailError = (text: string): void => {
    emailError.textContent = text;
    if (text) emailInput.setAttribute('aria-invalid', 'true');
    else emailInput.removeAttribute('aria-invalid');
  };

  const remember = (): void => {
    saveText(TEACHER_EMAIL_STORAGE_KEY, emailInput.value.trim());
    saveText(STUDENT_NAME_STORAGE_KEY, cleanName(nameInput.value));
  };

  /** The teacher's address, or null (with the error shown and the field focused) when it is not valid. */
  const teacherEmail = (): string | null => {
    const to = emailInput.value.trim();
    if (isValidEmail(to)) {
      setEmailError('');
      return to;
    }
    setEmailError(
      to === ''
        ? "Type your teacher's email address first."
        : 'This does not look like an email address. Check it (for example teacher@school.edu).',
    );
    emailInput.focus();
    return null;
  };

  const emailInputFor = (): ShareEmailInput => ({ ...payload, studentName: nameInput.value });

  const send = (provider: EmailProvider): void => {
    const to = teacherEmail();
    if (to === null) return;
    remember();
    const input = emailInputFor();
    const email = fitShareEmail(provider, to, input);
    if (email.trimmed === 'all') {
      // Start the copy before opening the email: the new tab takes the focus, and the clipboard needs it.
      copyText(shareEmailWorkText(input)).then(
        () =>
          notify('Your work is too long for an email link — the full text was copied: paste it into the email (Ctrl+V).'),
        () =>
          notify('Your work is too long for an email link. Copy the link above or download the .ino file and add it to the email.'),
      );
    } else {
      notify(`${SENT_WITH[provider]}${TRIM_NOTE[email.trimmed]}`);
    }
    openUrl(email.url, provider === 'mailto' ? '_self' : '_blank');
  };

  const copyEmail = (): void => {
    const to = teacherEmail();
    if (to === null) return;
    remember();
    const { subject, body } = buildShareEmail(emailInputFor());
    copyText(`To: ${to}\nSubject: ${subject}\n\n${body}`).then(
      () => notify(`Email text copied — paste it into a new email to ${to} (Ctrl+V).`),
      () => notify('The email text could not be copied. Copy the link above or download the .ino file instead.'),
    );
  };

  const copyLink = (): void => {
    copyText(payload.url).then(
      () => notify('Link copied'),
      () => {
        urlInput.focus();
        urlInput.select();
        notify('Press Ctrl+C to copy the link');
      },
    );
  };

  const download = (): void => {
    remember();
    const filename = inoFileName(nameInput.value);
    (options.download ?? downloadText)(filename, payload.code);
    notify(`Downloading ${filename}`);
  };

  // A read-only link: one click (or Tab) selects all of it, ready for Ctrl+C.
  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('click', () => urlInput.select());
  emailInput.addEventListener('input', () => {
    if (emailError.textContent) setEmailError('');
  });
  emailInput.addEventListener('change', remember);
  nameInput.addEventListener('change', remember);
  dialog.addEventListener('close', remember);
  // Enter in a field must not close the dialog: there is no single "submit" action here.
  form.addEventListener('submit', (e) => e.preventDefault());

  action('copy-link').addEventListener('click', copyLink);
  action('send-gmail').addEventListener('click', () => send('gmail'));
  action('send-outlook').addEventListener('click', () => send('outlook'));
  action('send-mailto').addEventListener('click', () => send('mailto'));
  action('copy-email').addEventListener('click', copyEmail);
  action('download').addEventListener('click', download);
  action('close').addEventListener('click', () => dialog.close());

  /** Save a text file through a temporary `<a download>` (kept inside the modal dialog, which makes the page inert). */
  function downloadText(filename: string, text: string): void {
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.hidden = true;
    dialog.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  parent.appendChild(dialog);

  return {
    open(next) {
      payload = next;
      urlInput.value = next.url;
      emailInput.value = loadText(TEACHER_EMAIL_STORAGE_KEY);
      nameInput.value = loadText(STUDENT_NAME_STORAGE_KEY);
      setEmailError('');
      status.textContent = '';
      if (!dialog.open) dialog.showModal();
      if (emailInput.value === '') emailInput.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
