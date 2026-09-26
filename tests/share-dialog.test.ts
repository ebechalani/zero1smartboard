// @vitest-environment happy-dom
/**
 * Share dialog tests (happy-dom): address, name and message cleaning, the
 * transport to the email relay (sendWorkToTeacher with a fake fetch), and
 * the dialog itself with its side effects (relay, clipboard, download)
 * replaced by spies. The relay script is tested in email-relay.test.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_RELAY_URL } from '../src/config';
import {
  CODE_MAX_LENGTH,
  LINK_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  NAME_MAX_LENGTH,
  SEND_ERROR_TEXT,
  STUDENT_NAME_STORAGE_KEY,
  TEACHER_EMAIL_STORAGE_KEY,
  cleanEmail,
  cleanMessage,
  cleanName,
  createShareDialog,
  isValidEmail,
  sendWorkToTeacher,
  type SendWorkError,
  type SendWorkRequest,
  type SendWorkResult,
  type ShareDialogOptions,
} from '../src/ui/share-dialog';

const SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(A1, HIGH);\n}\n';
const URL_CODE = 'https://example.org/sim/#code=dm9pZCBzZXR1cCgpIHt9';
const RELAY = 'https://relay.example/macros/s/abc/exec';
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

/** A promise settled from the outside (a relay answer that has not arrived yet). */
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(err: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Cleaning & validation
// ---------------------------------------------------------------------------

describe('isValidEmail', () => {
  it('accepts normal school addresses, with an apostrophe before the @', () => {
    const good = ['teacher@school.edu', 'j.dupont@lycee-example.edu.lb', 'mr.smith+robotics@school.org', 'T_Nguyen@Sub.School.EDU', "o'neil@school.edu"];
    for (const ok of good) expect(isValidEmail(ok), ok).toBe(true);
  });

  it('rejects anything that could add recipients', () => {
    const bad = [
      'a@b.c?cc=x',
      'a@b.c&bcc=x',
      'a b@c.d',
      'x',
      'a@b',
      '',
      ' a@b.c',
      'a@b.c,d@e.f',
      'a;b@c.d',
      'a@b.c#x',
      '<a@b.c>',
      '"a"@b.c',
      "a@b'c.d",
      "a@b.c'd",
      'a@@b.c',
      'a@b.c\nbcc@x.y',
      `${'a'.repeat(250)}@b.cd`,
    ];
    for (const text of bad) expect(isValidEmail(text), JSON.stringify(text)).toBe(false);
  });
});

describe('cleaning what the student typed', () => {
  it('removes invisible characters and spaces around the address', () => {
    expect(cleanEmail('  teacher@school.edu\n')).toBe('teacher@school.edu');
    expect(cleanEmail('​teacher@⁠school.edu‮\u0000\t')).toBe('teacher@school.edu');
    expect(cleanEmail('﻿teacher@school.edu')).toBe('teacher@school.edu');
    // Visible problems stay, so the student sees the error.
    expect(cleanEmail('teacher @school.edu')).toBe('teacher @school.edu');
  });

  it('keeps the name on one line, at most 60 characters', () => {
    expect(cleanName('  Alex \n\t Dupont​ ')).toBe('Alex Dupont');
    expect(cleanName('Alex\r\nBcc: x@evil.com')).toBe('Alex Bcc: x@evil.com');
    expect(cleanName('‮‍')).toBe('');
    expect(cleanName('x'.repeat(80))).toHaveLength(NAME_MAX_LENGTH);
    // Never half an emoji at the cut.
    expect(cleanName(`${'x'.repeat(59)}🙂`)).toBe('x'.repeat(59));
  });

  it('keeps the line breaks of the message, at most 500 characters', () => {
    expect(cleanMessage(' Hello Miss,\r\n\r\n\r\n\r\nHere it is.​\u0007 ')).toBe('Hello Miss,\n\nHere it is.');
    expect(cleanMessage('a b\tc')).toBe('a b c');
    expect(cleanMessage('x'.repeat(600))).toHaveLength(MESSAGE_MAX_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

describe('sendWorkToTeacher', () => {
  const request: SendWorkRequest = {
    to: 'teacher@school.edu',
    studentName: 'Alex',
    message: '',
    kind: 'code',
    link: URL_CODE,
    code: SKETCH,
    fileName: 'zero1_Alex_0926_143205.ino',
  };

  function answer(body: string, status = 200): typeof fetch {
    return vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));
  }

  it('POSTs the request as a plain text JSON body, so the browser sends no CORS preflight', async () => {
    const fetchImpl = answer('{"ok":true}');
    expect(await sendWorkToTeacher(RELAY, request, fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe(RELAY);
    expect(init!.method).toBe('POST');
    expect(init!.headers).toBeUndefined();
    expect(init!.redirect).toBe('follow');
    expect(JSON.parse(init!.body as string)).toEqual(request);
    // What the browser would send: a "simple" text/plain request.
    expect(new Request(RELAY, init).headers.get('content-type')).toBe('text/plain;charset=UTF-8');
  });

  it("passes on the relay's own errors", async () => {
    const result = await sendWorkToTeacher(RELAY, request, answer('{"ok":false,"error":"rate_limited","message":"More than 60"}'));
    expect(result).toEqual({ ok: false, error: 'rate_limited', message: 'More than 60' });
    for (const error of ['bad_request', 'recipient_not_allowed', 'quota_exceeded', 'send_failed']) {
      expect(await sendWorkToTeacher(RELAY, request, answer(JSON.stringify({ ok: false, error })))).toEqual({ ok: false, error, message: '' });
    }
  });

  it('reports anything that is not a relay answer as bad_response', async () => {
    const bodies = ['<!doctype html><title>Sign in</title>', '', '[]', 'null', '{"ok":"yes"}', '{"ok":false,"error":"exploded"}', '{"ok":false}'];
    for (const body of bodies) {
      const result = await sendWorkToTeacher(RELAY, request, answer(body, 200));
      expect(result, body).toMatchObject({ ok: false, error: 'bad_response' });
    }
    const notFound = await sendWorkToTeacher(RELAY, request, answer('Not Found', 404));
    expect(notFound).toMatchObject({ ok: false, error: 'bad_response' });
    expect((notFound as { message: string }).message).toContain('HTTP 404');
  });

  it('reports network errors (offline, CORS refusal) as network', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await sendWorkToTeacher(RELAY, request, fetchImpl)).toEqual({ ok: false, error: 'network', message: 'Failed to fetch' });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          signal = init!.signal!;
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = sendWorkToTeacher(RELAY, request, fetchImpl, 30000);
    await vi.advanceTimersByTimeAsync(29999);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal!.aborted).toBe(true);
    expect(await pending).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('does not call anything without a relay URL', async () => {
    const fetchImpl = answer('{"ok":true}');
    expect(await sendWorkToTeacher('', request, fetchImpl)).toMatchObject({ ok: false, error: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

describe('share dialog', () => {
  function setup(extra: ShareDialogOptions = {}) {
    const spies = {
      sendWork: vi.fn<(relayUrl: string, request: SendWorkRequest) => Promise<SendWorkResult>>(() => Promise.resolve({ ok: true })),
      copyText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
      toast: vi.fn<(text: string) => void>(),
      download: vi.fn<(fileName: string, text: string) => void>(),
    };
    const dialog = createShareDialog(mount(), { relayUrl: RELAY, ...spies, ...extra });
    const el = dialog.element;
    const q = <T extends HTMLElement>(selector: string): T => el.querySelector<T>(selector)!;
    return {
      dialog,
      spies,
      email: q<HTMLInputElement>('#z1-share-email'),
      name: q<HTMLInputElement>('#z1-share-name'),
      message: q<HTMLTextAreaElement>('#z1-share-message'),
      link: q<HTMLInputElement>('#z1-share-url'),
      emailError: q<HTMLElement>('#z1-share-email-error'),
      nameError: q<HTMLElement>('#z1-share-name-error'),
      status: q<HTMLElement>('[data-role="status"]'),
      sendStatus: q<HTMLElement>('[data-role="send-status"]'),
      section: q<HTMLElement>('[data-role="send"]'),
      notSetUp: q<HTMLElement>('[data-role="send-off"]'),
      sendButton: q<HTMLButtonElement>('[data-action="send"]'),
      click: (action: string) => q<HTMLButtonElement>(`[data-action="${action}"]`).click(),
      press: (input: HTMLElement, key = 'Enter') => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        return event;
      },
    };
  }

  const payload = { url: URL_CODE, code: SKETCH, kind: 'code' as const };

  /** Open the dialog with valid fields. */
  function ready(extra: ShareDialogOptions = {}) {
    const ui = setup(extra);
    ui.dialog.open(payload);
    ui.email.value = 'teacher@school.edu';
    ui.name.value = 'Alex';
    return ui;
  }

  it('is labelled by its heading, labels every field and shows the link when opened', () => {
    const { dialog, link, email, name, message, section, notSetUp } = setup();
    expect(dialog.isOpen()).toBe(false);
    dialog.open(payload);
    expect(dialog.isOpen()).toBe(true);
    const el = dialog.element;
    expect(el.tagName).toBe('DIALOG');
    expect(el.querySelector(`#${el.getAttribute('aria-labelledby')}`)!.textContent).toBe('Share your work');
    expect(link.value).toBe(URL_CODE);
    expect(link.readOnly).toBe(true);
    for (const field of el.querySelectorAll('input, textarea')) {
      expect(el.querySelector(`label[for="${field.id}"]`), field.id).not.toBeNull();
    }
    expect(el.querySelector('label[for="z1-share-name"]')!.textContent).toBe('Your name');
    expect(el.querySelector('label[for="z1-share-message"]')!.textContent).toBe('Message for your teacher (optional)');
    expect(email.type).toBe('email');
    // The field holds another person's address: the browser must not fill in the student's own.
    expect(email.autocomplete).toBe('off');
    expect(name.autocomplete).toBe('name');
    expect(name.required).toBe(true);
    expect(message.maxLength).toBe(MESSAGE_MAX_LENGTH);
    expect(section.hidden).toBe(false);
    expect(notSetUp.hidden).toBe(true);
    expect(el.textContent).toContain('Your name, message, link and code are emailed to your teacher.');
    // One way to send, and no leftovers of the old email buttons.
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy link', 'Send to teacher', 'Download .ino', 'Close']);
    // An empty teacher address is where the student starts typing.
    expect(document.activeElement).toBe(email);
  });

  it('hides the send section when no relay is set up', () => {
    const { dialog, section, notSetUp, email, click, spies } = setup({ relayUrl: '' });
    dialog.open(payload);
    expect(section.hidden).toBe(true);
    expect(notSetUp.hidden).toBe(false);
    expect(notSetUp.textContent).toBe('Sending to your teacher is not set up on this simulator yet — use Copy link or Download .ino.');
    expect(notSetUp.classList.contains('z1-muted')).toBe(true);
    expect(dialog.element.querySelector('[data-role="intro"]')!.textContent).not.toContain('teacher');
    expect(document.activeElement).not.toBe(email);
    // Enter in the hidden fields sends nothing; the other ways to share still work.
    email.value = 'teacher@school.edu';
    email.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(spies.sendWork).not.toHaveBeenCalled();
    click('download');
    expect(spies.download).toHaveBeenCalledTimes(1);
  });

  it('follows EMAIL_RELAY_URL by default', () => {
    const dialog = createShareDialog(mount());
    expect(dialog.element.querySelector<HTMLElement>('[data-role="send"]')!.hidden).toBe(EMAIL_RELAY_URL === '');
  });

  it('shows an error and sends nothing when the teacher email is missing or invalid', () => {
    const { dialog, spies, email, name, emailError, click, press } = setup();
    dialog.open(payload);
    name.value = 'Alex';
    click('send');
    expect(emailError.textContent).toContain("teacher's email");
    expect(email.getAttribute('aria-invalid')).toBe('true');

    for (const bad of ['a@b.c?cc=x', 'a@b.c&bcc=x', 'a b@c.d', 'x', 'a@b', 'a@b.c,d@e.f', "a@b'c.d"]) {
      email.value = bad;
      click('send');
      press(email);
      expect(emailError.textContent).toContain('does not look like an email address');
      expect(document.activeElement).toBe(email);
    }
    expect(spies.sendWork).not.toHaveBeenCalled();
    expect(localStorage.getItem(TEACHER_EMAIL_STORAGE_KEY)).toBeNull();

    // Typing again clears the error.
    email.value = 'teacher@school.edu';
    email.dispatchEvent(new Event('input'));
    expect(emailError.textContent).toBe('');
    expect(email.hasAttribute('aria-invalid')).toBe(false);
  });

  it('requires the student name', () => {
    const { dialog, spies, email, name, nameError, emailError, click } = setup();
    dialog.open(payload);
    email.value = 'teacher@school.edu';
    name.value = '  ​ ';
    click('send');
    expect(nameError.textContent).toBe('Type your name, so your teacher knows who sent it.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);
    expect(emailError.textContent).toBe('');
    expect(spies.sendWork).not.toHaveBeenCalled();

    // Both missing: both errors, the email field first.
    email.value = '';
    click('send');
    expect(emailError.textContent).not.toBe('');
    expect(nameError.textContent).not.toBe('');
    expect(document.activeElement).toBe(email);

    name.value = 'A';
    name.dispatchEvent(new Event('input'));
    expect(nameError.textContent).toBe('');
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });

  it('sends the work to the relay and says when it was sent', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const answer = deferred<SendWorkResult>();
    const sendWork = vi.fn((_relayUrl: string, _request: SendWorkRequest) => answer.promise);
    const { dialog, spies, email, name, message, sendButton, sendStatus, click } = setup({ sendWork });
    dialog.open({ ...payload, kind: 'blocks' });
    email.value = '​ Teacher@School.edu ';
    name.value = ' Élise \n Martin ';
    message.value = 'Hello Miss,\r\nhere is my project.';
    click('send');

    // The cleaned values are written back and remembered.
    expect(email.value).toBe('Teacher@School.edu');
    expect(name.value).toBe('Élise Martin');
    expect(localStorage.getItem(TEACHER_EMAIL_STORAGE_KEY)).toBe('Teacher@School.edu');
    expect(localStorage.getItem(STUDENT_NAME_STORAGE_KEY)).toBe('Élise Martin');

    // While sending: one request, the button disabled, a status for screen readers.
    expect(sendWork).toHaveBeenCalledTimes(1);
    expect(sendWork.mock.calls[0][1]).toMatchObject({ to: 'Teacher@School.edu', studentName: 'Élise Martin', message: 'Hello Miss,\nhere is my project.' });
    expect(sendButton.disabled).toBe(true);
    expect(sendButton.textContent).toBe('Sending…');
    expect(sendStatus.textContent).toBe('Sending to Teacher@School.edu…');
    expect(sendStatus.getAttribute('role')).toBe('status');
    expect(sendStatus.dataset.state).toBe('sending');
    answer.resolve({ ok: true });
    await flush();

    expect(sendButton.disabled).toBe(false);
    expect(sendButton.textContent).toBe('Send to teacher');
    expect(sendStatus.textContent).toBe('Sent to Teacher@School.edu. Your teacher will get it in a minute.');
    expect(sendStatus.dataset.state).toBe('ok');
    expect(spies.toast).toHaveBeenLastCalledWith(sendStatus.textContent);
    // The message is for this email only.
    expect(message.value).toBe('');
    expect(localStorage.length).toBe(2);
  });

  it('builds the relay request from the fields and the work', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { dialog, spies, email, name, message, click } = setup();
    dialog.open({ ...payload, kind: 'blocks' });
    email.value = "o'neil@school.edu";
    name.value = 'Élise Martin';
    message.value = 'Hi!\n\n\n\nDone.';
    click('send');
    await flush();
    expect(spies.sendWork).toHaveBeenCalledTimes(1);
    expect(spies.sendWork).toHaveBeenCalledWith(RELAY, {
      to: "o'neil@school.edu",
      studentName: 'Élise Martin',
      message: 'Hi!\n\nDone.',
      kind: 'blocks',
      link: URL_CODE,
      code: SKETCH,
      fileName: 'zero1_Elise_Martin_0926_143205.ino',
    });
  });

  it('sends once, however often the button is clicked or Enter is pressed', async () => {
    const answer = deferred<SendWorkResult>();
    const sendWork = vi.fn(() => answer.promise);
    const { email, name, click, press } = ready({ sendWork });
    click('send');
    click('send');
    press(email);
    press(name);
    expect(sendWork).toHaveBeenCalledTimes(1);
    answer.resolve({ ok: true });
    await flush();
    click('send');
    await flush();
    expect(sendWork).toHaveBeenCalledTimes(2);
  });

  it('sends on Enter in the email or name field, never submits the form', async () => {
    const { dialog, spies, email, name, message, press } = ready();
    const enter = press(email);
    expect(enter.defaultPrevented).toBe(true);
    await flush();
    expect(spies.sendWork).toHaveBeenCalledTimes(1);
    press(name);
    await flush();
    expect(spies.sendWork).toHaveBeenCalledTimes(2);
    // Enter in the message is a new line; other keys do nothing.
    expect(press(message).defaultPrevented).toBe(false);
    press(email, 'a');
    await flush();
    expect(spies.sendWork).toHaveBeenCalledTimes(2);

    const submit = new Event('submit', { cancelable: true });
    dialog.element.querySelector('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(dialog.isOpen()).toBe(true);
  });

  it('explains every relay error in plain words', async () => {
    const errors: SendWorkError[] = ['network', 'timeout', 'rate_limited', 'quota_exceeded', 'bad_request', 'send_failed', 'bad_response', 'not_configured'];
    for (const error of errors) {
      const { sendStatus, sendButton, message, click } = ready({
        sendWork: () => Promise.resolve({ ok: false, error, message: 'technical details' }),
      });
      message.value = 'keep me';
      click('send');
      await flush();
      expect(sendStatus.textContent, error).toBe(SEND_ERROR_TEXT[error]);
      expect(sendStatus.dataset.state).toBe('error');
      expect(sendStatus.textContent).not.toContain('technical');
      expect(sendButton.disabled).toBe(false);
      // Nothing was sent: the message stays for the next try.
      expect(message.value).toBe('keep me');
      document.body.innerHTML = '';
    }
    expect(SEND_ERROR_TEXT.network).toBe('Could not reach the email service. Check your internet connection and try again.');
    expect(SEND_ERROR_TEXT.timeout).toBe(SEND_ERROR_TEXT.network);
  });

  it('shows a refused address next to the email field', async () => {
    const { email, emailError, sendStatus, click } = ready({
      sendWork: () => Promise.resolve({ ok: false, error: 'recipient_not_allowed', message: '' }),
    });
    click('send');
    await flush();
    expect(emailError.textContent).toBe("This simulator can only send to school teachers' addresses. Check the email address.");
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email);
    expect(sendStatus.textContent).toBe('');
  });

  it('treats a failing sendWork and an offline browser as a network problem', async () => {
    const failing = ready({ sendWork: () => Promise.reject(new Error('boom')) });
    failing.click('send');
    await flush();
    expect(failing.sendStatus.textContent).toBe(SEND_ERROR_TEXT.network);
    expect(failing.sendButton.disabled).toBe(false);
    document.body.innerHTML = '';

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const offline = ready();
    offline.click('send');
    await flush();
    expect(offline.spies.sendWork).not.toHaveBeenCalled();
    expect(offline.sendStatus.textContent).toBe(SEND_ERROR_TEXT.network);
  });

  it('leaves a too long link out and refuses empty or too long code', async () => {
    // Opening again re-reads the remembered fields.
    localStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, 'teacher@school.edu');
    localStorage.setItem(STUDENT_NAME_STORAGE_KEY, 'Alex');
    const { dialog, spies, sendStatus, click } = setup();
    const longLink = `https://example.org/#blocks=${'x'.repeat(LINK_MAX_LENGTH)}`;
    dialog.open({ ...payload, url: longLink });
    click('send');
    await flush();
    expect(spies.sendWork.mock.lastCall![1].link).toBe('');
    expect(sendStatus.textContent).toBe(
      'Sent to teacher@school.edu. Your teacher will get it in a minute. Your link was too long, so the email has your code only.',
    );

    dialog.open({ ...payload, code: 'x'.repeat(CODE_MAX_LENGTH + 1) });
    click('send');
    await flush();
    expect(sendStatus.textContent).toBe('Your code is too long to send by email. Use Download .ino instead.');
    dialog.open({ ...payload, code: ' \n' });
    click('send');
    await flush();
    expect(sendStatus.textContent).toBe('Your sketch is empty — there is nothing to send yet.');
    expect(spies.sendWork).toHaveBeenCalledTimes(1);
  });

  it('clears old errors and re-reads the stored fields when opened again', async () => {
    const { dialog, email, name, emailError, sendStatus, status, click } = setup({
      sendWork: () => Promise.resolve({ ok: false, error: 'send_failed', message: '' }),
    });
    dialog.open(payload);
    click('send'); // empty fields: errors
    expect(emailError.textContent).not.toBe('');
    email.value = 'teacher@school.edu';
    name.value = 'Alex';
    click('send');
    await flush();
    expect(sendStatus.textContent).toBe(SEND_ERROR_TEXT.send_failed);
    click('download');
    expect(status.textContent).not.toBe('');
    dialog.close();

    localStorage.setItem(TEACHER_EMAIL_STORAGE_KEY, 'other@school.edu');
    dialog.open(payload);
    expect(email.value).toBe('other@school.edu');
    expect(name.value).toBe('Alex');
    expect(emailError.textContent).toBe('');
    expect(email.hasAttribute('aria-invalid')).toBe(false);
    expect(sendStatus.textContent).toBe('');
    expect(status.textContent).toBe('');
  });

  it('keeps showing a send in progress when opened again', async () => {
    const answer = deferred<SendWorkResult>();
    const { dialog, sendButton, sendStatus, click } = ready({ sendWork: () => answer.promise });
    click('send');
    dialog.close();
    dialog.open(payload);
    expect(sendButton.disabled).toBe(true);
    expect(sendStatus.dataset.state).toBe('sending');
    answer.resolve({ ok: true });
    await flush();
    expect(sendButton.disabled).toBe(false);
    expect(sendStatus.dataset.state).toBe('ok');
  });

  it('remembers the teacher email and the student name for the next time', () => {
    const first = setup();
    first.dialog.open(payload);
    first.email.value = ' teacher@school.edu​';
    first.email.dispatchEvent(new Event('change'));
    expect(first.email.value).toBe('teacher@school.edu');
    expect(localStorage.getItem(TEACHER_EMAIL_STORAGE_KEY)).toBe('teacher@school.edu');

    first.name.value = 'Alex D.';
    first.name.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(STUDENT_NAME_STORAGE_KEY)).toBe('Alex D.');
    first.message.value = 'not remembered';
    first.dialog.close();

    const second = setup();
    second.dialog.open(payload);
    expect(second.email.value).toBe('teacher@school.edu');
    expect(second.name.value).toBe('Alex D.');
    expect(second.message.value).toBe('');
    // Both fields are known: the focus does not jump to the email field.
    expect(document.activeElement).not.toBe(second.email);
  });

  it('works without localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const { dialog, email, click } = setup();
    dialog.open(payload);
    expect(email.value).toBe('');
    email.value = 'teacher@school.edu';
    email.dispatchEvent(new Event('change'));
    click('download');
    expect(dialog.isOpen()).toBe(true);
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

  it('downloads the sketch as a unique .ino file named after the student', () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    const { dialog, spies, name, status, click } = setup();
    dialog.open(payload);
    click('download');
    expect(spies.download).toHaveBeenLastCalledWith('zero1_0926_143205.ino', SKETCH);
    expect(status.textContent).toBe('Downloading zero1_0926_143205.ino');
    name.value = 'Élise Martin';
    click('download');
    expect(spies.download).toHaveBeenLastCalledWith('zero1_Elise_Martin_0926_143205.ino', SKETCH);
    expect(localStorage.getItem(STUDENT_NAME_STORAGE_KEY)).toBe('Élise Martin');
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

  it('closes with the Close button', () => {
    const { dialog, click } = setup();
    dialog.open(payload);
    click('close');
    expect(dialog.isOpen()).toBe(false);
  });
});
