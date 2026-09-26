/**
 * Share dialog: everything a student needs to hand in their work — the share
 * link (`#code=` / `#blocks=`), "Send to teacher", which emails the link and
 * the Arduino code straight to the teacher, and the sketch as an `.ino` file
 * for the Arduino IDE.
 *
 * A static page cannot send email itself. "Send to teacher" POSTs the work
 * to the teacher's email relay: a small Google Apps Script web app
 * (tools/email-relay/Code.gs) that the teacher deploys once from their own
 * Google account (docs/EMAIL.md). The relay checks the address against the
 * school's allow-list and sends the email, with the sketch attached, from
 * the teacher's account; nothing else opens on the student's computer. While
 * EMAIL_RELAY_URL (src/config.ts) is empty the send section is hidden.
 *
 * The teacher's address and the student's name are remembered in localStorage.
 */
import { EMAIL_RELAY_URL } from '../config';
import { downloadTextFile, sketchFileName } from './sketch-file';

/** localStorage key of the teacher's email address. */
export const TEACHER_EMAIL_STORAGE_KEY = 'z1.teacherEmail';
/** localStorage key of the student's name (used in the email and the file name). */
export const STUDENT_NAME_STORAGE_KEY = 'z1.studentName';

/** What is being shared: a hand-written sketch or a blocks program. */
export type ShareKind = 'code' | 'blocks';

export interface SharePayload {
  /** The `#code=` / `#blocks=` share link. */
  url: string;
  /** The Arduino sketch (in Blocks mode: the sketch generated from the blocks). */
  code: string;
  kind: ShareKind;
}

/** Field limits, the same as the relay's (tools/email-relay/Code.gs). */
export const NAME_MAX_LENGTH = 60;
export const MESSAGE_MAX_LENGTH = 500;
/** A longer share link is left out of the email (the code is still in it). */
export const LINK_MAX_LENGTH = 60000;
export const CODE_MAX_LENGTH = 100000;

/**
 * A plain email address: no spaces and none of `, ; ? & # < > "`, so what the
 * student types is always exactly one recipient. An apostrophe is fine before
 * the `@` (o'neil@school.edu) but not in the domain. The relay checks the
 * address again, more strictly, and against the school's allow-list.
 */
const EMAIL_PATTERN = /^[^\s@,;?&#<>"]+@[^\s@,;?&#<>"']+\.[^\s@,;?&#<>"']+$/;
/** Longest address allowed by the mail standards. */
const EMAIL_MAX_LENGTH = 254;

/** Invisible characters: controls, format characters (zero-width, bidi overrides) and lone surrogates. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const INVISIBLE_EXCEPT_NEWLINE = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}]/gu;

/** Whether `text` is an email address the dialog accepts (see EMAIL_PATTERN). */
export function isValidEmail(text: string): boolean {
  return text.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(text);
}

/** A typed or pasted address without invisible characters or surrounding spaces. */
export function cleanEmail(text: string): string {
  return text.replace(INVISIBLE, '').trim();
}

/** The name as it appears in the email: one line, single spaces, at most NAME_MAX_LENGTH characters. */
export function cleanName(text: string): string {
  const name = text.replace(/\s/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  return cutAt(name, NAME_MAX_LENGTH).trim();
}

/** The optional message: line breaks kept (at most one empty line in a row), at most MESSAGE_MAX_LENGTH characters. */
export function cleanMessage(text: string): string {
  const message = text
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]/g, ' ')
    .replace(INVISIBLE_EXCEPT_NEWLINE, '')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cutAt(message, MESSAGE_MAX_LENGTH).trim();
}

/** The first `max` UTF-16 units of `text`, without half an emoji at the end. */
function cutAt(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

// ---------------------------------------------------------------------------
// Sending (the email relay)
// ---------------------------------------------------------------------------

/** What the relay receives (JSON). */
export interface SendWorkRequest {
  /** The teacher's address. */
  to: string;
  studentName: string;
  /** The student's message for the teacher, or ''. */
  message: string;
  kind: ShareKind;
  /** The share link, or '' when it is longer than LINK_MAX_LENGTH. */
  link: string;
  code: string;
  /** Name of the attached sketch: sketchFileName(). */
  fileName: string;
}

/** Errors the relay itself answers with (tools/email-relay/Code.gs). */
const RELAY_ERRORS = ['bad_request', 'recipient_not_allowed', 'rate_limited', 'quota_exceeded', 'send_failed'] as const;

/**
 * Why the work was not sent: one of the relay's own answers, or no relay URL,
 * no connection, no answer in time, or an answer that is not the relay's.
 */
export type SendWorkError = (typeof RELAY_ERRORS)[number] | 'not_configured' | 'network' | 'timeout' | 'bad_response';

export type SendWorkResult = { ok: true } | { ok: false; error: SendWorkError; message: string };

/**
 * POST the work to the email relay and read its JSON answer. The body is a
 * plain string, which fetch sends as `text/plain`: a "simple" request, so
 * the browser sends no CORS preflight (Apps Script cannot answer one). Apps
 * Script answers through a redirect to script.googleusercontent.com, which
 * fetch follows and which allows any origin. Never rejects.
 */
export async function sendWorkToTeacher(
  relayUrl: string,
  request: SendWorkRequest,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30000,
): Promise<SendWorkResult> {
  if (!relayUrl) return { ok: false, error: 'not_configured', message: 'EMAIL_RELAY_URL is empty (src/config.ts).' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(relayUrl, {
      method: 'POST',
      body: JSON.stringify(request),
      redirect: 'follow',
      signal: controller.signal,
    });
    return readRelayAnswer(await response.text(), response.status);
  } catch (err) {
    return timedOut
      ? { ok: false, error: 'timeout', message: `No answer from the relay after ${timeoutMs} ms.` }
      : { ok: false, error: 'network', message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The relay's `{ ok: true }` / `{ ok: false, error, message }`, or 'bad_response' for anything else. */
function readRelayAnswer(text: string, status: number): SendWorkResult {
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // An HTML page (a Google sign-in or error page, a captive portal...): handled below.
  }
  if (typeof data === 'object' && data !== null) {
    const answer = data as { ok?: unknown; error?: unknown; message?: unknown };
    if (answer.ok === true) return { ok: true };
    const error = RELAY_ERRORS.find((e) => e === answer.error);
    if (answer.ok === false && error) {
      return { ok: false, error, message: typeof answer.message === 'string' ? answer.message : '' };
    }
  }
  return { ok: false, error: 'bad_response', message: `Unexpected answer (HTTP ${status}): ${text.slice(0, 200)}` };
}

/** Shown in place of the send section while EMAIL_RELAY_URL is empty. */
const NOT_SET_UP = 'Sending to your teacher is not set up on this simulator yet — use Copy link or Download .ino.';
const OFFLINE = 'Could not reach the email service. Check your internet connection and try again.';

/** What the student reads when the work was not sent. */
export const SEND_ERROR_TEXT: Readonly<Record<SendWorkError, string>> = {
  network: OFFLINE,
  timeout: OFFLINE,
  recipient_not_allowed: "This simulator can only send to school teachers' addresses. Check the email address.",
  rate_limited: 'Too many emails were sent from this simulator in the last hour. Try again later.',
  quota_exceeded: 'The email service cannot send any more emails today. Try again tomorrow, or use Copy link or Download .ino.',
  bad_request: 'The email service did not accept your work. Check the email address and your name, then try again.',
  send_failed: 'The email could not be sent. Try again in a minute.',
  bad_response: 'The email service gave an unexpected answer. Try again later, or use Copy link or Download .ino.',
  not_configured: NOT_SET_UP,
};

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
  /** The email relay's web app URL (default: EMAIL_RELAY_URL). Empty: the send section is hidden. */
  relayUrl?: string;
  /** Send the work to the relay (default: sendWorkToTeacher). */
  sendWork?(relayUrl: string, request: SendWorkRequest): Promise<SendWorkResult>;
  /** Put text on the clipboard (default: navigator.clipboard.writeText). */
  copyText?(text: string): Promise<void>;
  /**
   * Also called with every feedback message. The dialog always shows them
   * itself: a page toast would sit under the modal backdrop.
   */
  toast?(text: string): void;
  /** Save a text file (default: downloadTextFile inside the dialog). */
  download?(fileName: string, text: string): void;
}

export interface ShareDialog {
  /** Show the dialog for this link and sketch. */
  open(payload: SharePayload): void;
  close(): void;
  isOpen(): boolean;
  readonly element: HTMLDialogElement;
}

function defaultCopyText(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

/**
 * Create the share `<dialog>` and append it to `parent`.
 */
export function createShareDialog(parent: HTMLElement, options: ShareDialogOptions = {}): ShareDialog {
  const relayUrl = options.relayUrl ?? EMAIL_RELAY_URL;
  const sendWork = options.sendWork ?? ((url: string, request: SendWorkRequest) => sendWorkToTeacher(url, request));
  const copyText = options.copyText ?? defaultCopyText;

  const dialog = document.createElement('dialog');
  dialog.className = 'z1-dialog z1-share';
  dialog.setAttribute('aria-labelledby', 'z1-share-title');
  dialog.innerHTML = `
    <form class="z1-dialog-form" novalidate>
      <h2 id="z1-share-title">Share your work</h2>
      <p class="z1-muted" data-role="intro"></p>

      <div class="z1-setting">
        <label for="z1-share-url">Link</label>
        <div class="z1-share-row">
          <input type="text" id="z1-share-url" readonly spellcheck="false" aria-describedby="z1-share-url-help" />
          <button type="button" class="z1-btn" data-action="copy-link">Copy link</button>
        </div>
        <p class="z1-setting-help" id="z1-share-url-help">Anyone who opens this link sees your work in the simulator.</p>
      </div>

      <fieldset class="z1-share-section" data-role="send">
        <legend>Send to your teacher</legend>
        <div class="z1-share-fields">
          <div class="z1-setting">
            <label for="z1-share-email">Teacher's email</label>
            <input type="email" id="z1-share-email" autocomplete="off" placeholder="teacher@school.edu" required spellcheck="false" aria-describedby="z1-share-email-error" />
            <p class="z1-share-error" id="z1-share-email-error" aria-live="polite"></p>
          </div>
          <div class="z1-setting">
            <label for="z1-share-name">Your name</label>
            <input type="text" id="z1-share-name" autocomplete="name" maxlength="${NAME_MAX_LENGTH}" required aria-describedby="z1-share-name-error" />
            <p class="z1-share-error" id="z1-share-name-error" aria-live="polite"></p>
          </div>
        </div>
        <div class="z1-setting">
          <label for="z1-share-message">Message for your teacher (optional)</label>
          <textarea id="z1-share-message" rows="2" maxlength="${MESSAGE_MAX_LENGTH}"></textarea>
        </div>
        <div class="z1-share-send">
          <button type="button" class="z1-btn z1-btn-primary" data-action="send">Send to teacher</button>
          <p class="z1-share-send-status" data-role="send-status" role="status" aria-live="polite"></p>
        </div>
        <p class="z1-setting-help">Your name, message, link and code are emailed to your teacher.</p>
      </fieldset>
      <p class="z1-share-off z1-muted" data-role="send-off">${NOT_SET_UP}</p>

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
  const messageInput = dialog.querySelector<HTMLTextAreaElement>('#z1-share-message')!;
  const emailError = dialog.querySelector<HTMLElement>('#z1-share-email-error')!;
  const nameError = dialog.querySelector<HTMLElement>('#z1-share-name-error')!;
  const role = (name: string): HTMLElement => dialog.querySelector<HTMLElement>(`[data-role="${name}"]`)!;
  const status = role('status');
  const sendStatus = role('send-status');
  const action = (name: string): HTMLButtonElement => dialog.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
  const sendButton = action('send');

  // Teachers: "Send to teacher" needs your email relay. Set it up as described
  // in docs/EMAIL.md and put its URL in src/config.ts (EMAIL_RELAY_URL); until
  // then students only see the NOT_SET_UP line and use Copy link / Download .ino.
  const canSend = relayUrl !== '';
  role('send').hidden = !canSend;
  role('send-off').hidden = canSend;
  role('intro').textContent = canSend
    ? 'Send it to your teacher, share the link, or keep a copy for the Arduino IDE.'
    : 'Share the link, or keep a copy for the Arduino IDE.';

  let payload: SharePayload = { url: '', code: '', kind: 'code' };
  /** A send is waiting for the relay's answer: the button stays disabled. */
  let sending = false;

  const notify = (text: string): void => {
    status.textContent = text;
    options.toast?.(text);
  };

  const setSendStatus = (state: '' | 'sending' | 'ok' | 'error', text: string): void => {
    sendStatus.textContent = text;
    sendStatus.dataset.state = state;
    if (text && state !== 'sending') options.toast?.(text);
  };

  const setFieldError = (input: HTMLInputElement, slot: HTMLElement, text: string): void => {
    slot.textContent = text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  const remember = (): void => {
    saveText(TEACHER_EMAIL_STORAGE_KEY, cleanEmail(emailInput.value));
    saveText(STUDENT_NAME_STORAGE_KEY, cleanName(nameInput.value));
  };

  /** Check both fields (cleaned values are written back); shows the errors and focuses the first bad field. */
  const checkFields = (): { to: string; name: string } | null => {
    const to = cleanEmail(emailInput.value);
    const name = cleanName(nameInput.value);
    emailInput.value = to;
    nameInput.value = name;
    const emailProblem =
      to === ''
        ? "Type your teacher's email address first."
        : isValidEmail(to)
          ? ''
          : 'This does not look like an email address. Check it (for example teacher@school.edu).';
    const nameProblem = name === '' ? 'Type your name, so your teacher knows who sent it.' : '';
    setFieldError(emailInput, emailError, emailProblem);
    setFieldError(nameInput, nameError, nameProblem);
    if (emailProblem) emailInput.focus();
    else if (nameProblem) nameInput.focus();
    return emailProblem || nameProblem ? null : { to, name };
  };

  const send = async (): Promise<void> => {
    if (sending || !canSend) return;
    const fields = checkFields();
    if (fields === null) {
      setSendStatus('', '');
      return;
    }
    remember();
    const { to, name } = fields;
    const work = payload;
    if (work.code.trim() === '') {
      setSendStatus('error', 'Your sketch is empty — there is nothing to send yet.');
      return;
    }
    if (work.code.length > CODE_MAX_LENGTH) {
      setSendStatus('error', 'Your code is too long to send by email. Use Download .ino instead.');
      return;
    }
    if (navigator.onLine === false) {
      setSendStatus('error', SEND_ERROR_TEXT.network);
      return;
    }
    const request: SendWorkRequest = {
      to,
      studentName: name,
      message: cleanMessage(messageInput.value),
      kind: work.kind,
      link: work.url.length <= LINK_MAX_LENGTH ? work.url : '',
      code: work.code,
      fileName: sketchFileName(name, new Date()),
    };

    sending = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Sending…';
    setSendStatus('sending', `Sending to ${to}…`);
    let result: SendWorkResult;
    try {
      result = await sendWork(relayUrl, request);
    } catch (err) {
      result = { ok: false, error: 'network', message: String(err) };
    } finally {
      sending = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Send to teacher';
    }

    if (result.ok) {
      messageInput.value = '';
      const note = request.link ? '' : ' Your link was too long, so the email has your code only.';
      setSendStatus('ok', `Sent to ${to}. Your teacher will get it in a minute.${note}`);
    } else if (result.error === 'recipient_not_allowed') {
      setSendStatus('', '');
      setFieldError(emailInput, emailError, SEND_ERROR_TEXT.recipient_not_allowed);
      options.toast?.(SEND_ERROR_TEXT.recipient_not_allowed);
      emailInput.focus();
    } else {
      setSendStatus('error', SEND_ERROR_TEXT[result.error]);
    }
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
    const fileName = sketchFileName(cleanName(nameInput.value), new Date());
    if (options.download) options.download(fileName, payload.code);
    else downloadTextFile(fileName, payload.code, dialog); // inside the modal: it makes the rest of the page inert
    notify(`Downloading ${fileName}`);
  };

  // A read-only link: one click (or Tab) selects all of it, ready for Ctrl+C.
  urlInput.addEventListener('focus', () => urlInput.select());
  urlInput.addEventListener('click', () => urlInput.select());
  emailInput.addEventListener('input', () => {
    if (emailError.textContent) setFieldError(emailInput, emailError, '');
  });
  nameInput.addEventListener('input', () => {
    if (nameError.textContent) setFieldError(nameInput, nameError, '');
  });
  emailInput.addEventListener('change', () => {
    emailInput.value = cleanEmail(emailInput.value);
    remember();
  });
  nameInput.addEventListener('change', remember);
  dialog.addEventListener('close', remember);
  // Enter in the email or name field sends (Enter in the message is a new line).
  for (const input of [emailInput, nameInput]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      void send();
    });
  }
  // The form must never submit: that would close the dialog (or reload the page).
  form.addEventListener('submit', (e) => e.preventDefault());

  sendButton.addEventListener('click', () => void send());
  action('copy-link').addEventListener('click', copyLink);
  action('download').addEventListener('click', download);
  action('close').addEventListener('click', () => dialog.close());

  parent.appendChild(dialog);

  return {
    open(next) {
      payload = next;
      urlInput.value = next.url;
      emailInput.value = loadText(TEACHER_EMAIL_STORAGE_KEY);
      nameInput.value = loadText(STUDENT_NAME_STORAGE_KEY);
      setFieldError(emailInput, emailError, '');
      setFieldError(nameInput, nameError, '');
      status.textContent = '';
      if (!sending) setSendStatus('', '');
      if (!dialog.open) dialog.showModal();
      if (canSend && emailInput.value === '') emailInput.focus();
      else if (canSend && nameInput.value === '') nameInput.focus();
    },
    close: () => dialog.close(),
    isOpen: () => dialog.open,
    element: dialog,
  };
}
