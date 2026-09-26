// @vitest-environment happy-dom
/**
 * Share dialog tests (happy-dom): the pure email helpers (wording, link
 * encoding for Gmail / Outlook / mailto:, the length fallbacks, address
 * validation, .ino file name) and the dialog itself with its side effects
 * (open a link, clipboard, download) replaced by spies.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMAIL_URL_BUDGET,
  MAILTO_URL_BUDGET,
  STUDENT_NAME_STORAGE_KEY,
  TEACHER_EMAIL_STORAGE_KEY,
  WEBMAIL_URL_BUDGET,
  buildShareEmail,
  composeEmailUrl,
  createShareDialog,
  fitShareEmail,
  inoFileName,
  isValidEmail,
  shareEmailWorkText,
  type EmailProvider,
  type ShareDialogOptions,
  type ShareEmailInput,
} from '../src/ui/share-dialog';

const SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(A1, HIGH);\n}\n';
const URL_CODE = 'https://example.org/sim/#code=dm9pZCBzZXR1cCgpIHt9';

/** Text that breaks naive URL building: every URL delimiter, `%`, `+`, quotes, unicode and line breaks. */
const TRICKY = 'a & b # c ? d % e + f = g / h\nTempérature: 24°C ✓ 🌡 "q" <x> \'y\'\n%0A%20+';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** Split `a=1&b=2` into decoded pairs (fails the test on a stray `&` or `=`). */
function params(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const parts = pair.split('=');
    expect(parts).toHaveLength(2);
    out[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Email text
// ---------------------------------------------------------------------------

describe('buildShareEmail', () => {
  it('writes a sketch email with the link, the code between separators and the name', () => {
    const { subject, body } = buildShareEmail({ url: URL_CODE, code: SKETCH, kind: 'code', studentName: 'Alex Dupont' });
    expect(subject).toBe('ZERO1 sketch from Alex Dupont');
    const lines = body.split('\n');
    expect(lines[0]).toBe('Hello,');
    expect(body).toContain('Here is my sketch for the ZERO1 Smart Board.');
    expect(body).toContain(`Open it in the simulator:\n${URL_CODE}\n`);
    expect(body).toContain('Arduino code:\n');
    // The code sits between two identical separator lines.
    const sep = lines.find((l) => /^-{10,}$/.test(l))!;
    const first = lines.indexOf(sep);
    const last = lines.lastIndexOf(sep);
    expect(last).toBeGreaterThan(first);
    expect(lines.slice(first + 1, last).join('\n')).toBe(SKETCH.trimEnd());
    expect(lines[lines.length - 1]).toBe('Alex Dupont');
    expect(body).not.toContain('\r');
  });

  it('leaves the name out when there is none', () => {
    const { subject, body } = buildShareEmail({ url: URL_CODE, code: SKETCH, kind: 'code', studentName: '   ' });
    expect(subject).toBe('ZERO1 sketch');
    expect(body.trimEnd().endsWith('-'.repeat(10))).toBe(true);
    expect(buildShareEmail({ url: URL_CODE, code: SKETCH, kind: 'code' }).subject).toBe('ZERO1 sketch');
  });

  it('says the code was generated from the blocks in Blocks mode', () => {
    const { subject, body } = buildShareEmail({ url: URL_CODE, code: SKETCH, kind: 'blocks', studentName: ' Sam \n Lee ' });
    expect(subject).toBe('ZERO1 blocks program from Sam Lee');
    expect(body).toContain('Here is my blocks program for the ZERO1 Smart Board.');
    expect(body).toContain('Arduino code generated from my blocks:');
    expect(buildShareEmail({ url: URL_CODE, code: SKETCH, kind: 'blocks' }).subject).toBe('ZERO1 blocks program');
  });
});

// ---------------------------------------------------------------------------
// Email links
// ---------------------------------------------------------------------------

describe('composeEmailUrl', () => {
  it('builds a Gmail compose link whose parameters decode back to the exact text', () => {
    const url = composeEmailUrl('gmail', 'teacher@school.edu', `Subject ${TRICKY}`, TRICKY);
    const prefix = 'https://mail.google.com/mail/?';
    expect(url.startsWith(prefix)).toBe(true);
    expect(params(url.slice(prefix.length))).toEqual({
      view: 'cm',
      fs: '1',
      to: 'teacher@school.edu',
      su: `Subject ${TRICKY}`,
      body: TRICKY,
    });
    expect(url).not.toMatch(/[\s#"<>]/);
  });

  it('builds an Outlook compose link whose parameters decode back to the exact text', () => {
    const url = composeEmailUrl('outlook', 'teacher@school.edu', TRICKY, `${TRICKY}\n${SKETCH}`);
    const prefix = 'https://outlook.office.com/mail/deeplink/compose?';
    expect(url.startsWith(prefix)).toBe(true);
    expect(params(url.slice(prefix.length))).toEqual({ to: 'teacher@school.edu', subject: TRICKY, body: `${TRICKY}\n${SKETCH}` });
  });

  it('builds a mailto: link with a literal @, encoded address parts and CRLF line breaks', () => {
    const url = composeEmailUrl('mailto', 'mr.smith+robotics@school.edu', TRICKY, `line 1\nline 2\r\nline 3\r${TRICKY}`);
    const [address, query] = url.slice('mailto:'.length).split('?');
    expect(url.startsWith('mailto:mr.smith%2Brobotics@school.edu?')).toBe(true);
    expect(decodeURIComponent(address)).toBe('mr.smith+robotics@school.edu');
    const { subject, body } = params(query);
    const crlf = (s: string): string => s.replace(/\r\n|\r|\n/g, '\r\n');
    expect(subject).toBe(crlf(TRICKY));
    expect(body).toBe(crlf(`line 1\nline 2\r\nline 3\r${TRICKY}`));
    expect(body.startsWith('line 1\r\nline 2\r\nline 3\r\n')).toBe(true);
    // Every line break is sent as %0D%0A, never as a bare %0A or %0D.
    const breaks = url.replace(/%0D%0A/g, '');
    expect(breaks).not.toMatch(/%0A|%0D/);
    expect(url).not.toMatch(/[\s#"<>]/);
  });
});

// ---------------------------------------------------------------------------
// Length fallbacks
// ---------------------------------------------------------------------------

describe('fitShareEmail', () => {
  // A long link (like a #blocks= link) with a short sketch.
  const input: ShareEmailInput = {
    url: `https://example.org/sim/#blocks=${'QUJD'.repeat(700)}`,
    code: SKETCH,
    kind: 'blocks',
    studentName: 'Alex',
  };
  const to = 'teacher@school.edu';

  it('keeps link and code when they fit', () => {
    const full = fitShareEmail('gmail', to, input);
    expect(full.trimmed).toBe('none');
    expect(full.body).toBe(buildShareEmail(input).body);
    expect(full.url).toBe(composeEmailUrl('gmail', to, full.subject, full.body));
    expect(full.url.length).toBeLessThanOrEqual(WEBMAIL_URL_BUDGET);
  });

  it('falls back to link only, then code only, then a short body', () => {
    for (const provider of ['gmail', 'outlook', 'mailto'] as EmailProvider[]) {
      const full = fitShareEmail(provider, to, input, Infinity);
      const linkOnly = fitShareEmail(provider, to, input, full.url.length - 1);
      expect(linkOnly.trimmed).toBe('code');
      expect(linkOnly.body).toContain(input.url);
      expect(linkOnly.body).not.toContain('digitalWrite');
      expect(linkOnly.body).toContain('the link shows it in the Code tab');

      const codeOnly = fitShareEmail(provider, to, input, linkOnly.url.length - 1);
      expect(codeOnly.trimmed).toBe('link');
      expect(codeOnly.body).not.toContain(input.url);
      expect(codeOnly.body).toContain('digitalWrite(A1, HIGH);');
      expect(codeOnly.body).toContain('too long for an email');

      const short = fitShareEmail(provider, to, input, codeOnly.url.length - 1);
      expect(short.trimmed).toBe('all');
      expect(short.body).toContain('pasted it below');
      expect(short.body).not.toContain(input.url);
      expect(short.body).not.toContain('digitalWrite');
      expect(short.subject).toBe('ZERO1 blocks program from Alex');

      for (const fitted of [full, linkOnly, codeOnly, short]) {
        expect(fitted.url).toBe(composeEmailUrl(provider, to, fitted.subject, fitted.body));
      }
    }
  });

  it('uses the per-provider budgets by default', () => {
    expect(EMAIL_URL_BUDGET).toEqual({ gmail: WEBMAIL_URL_BUDGET, outlook: WEBMAIL_URL_BUDGET, mailto: MAILTO_URL_BUDGET });
    // The 2800-character link fits a web mail link but not a mailto: link.
    expect(fitShareEmail('outlook', to, input).trimmed).toBe('none');
    const mailto = fitShareEmail('mailto', to, input);
    expect(mailto.trimmed).toBe('link');
    expect(mailto.url.length).toBeLessThanOrEqual(MAILTO_URL_BUDGET);
    // A short code link fits everything, even in a mailto: link.
    const small = { url: URL_CODE, code: SKETCH, kind: 'code' as const };
    expect(fitShareEmail('mailto', to, small).trimmed).toBe('none');
  });

  it('gives the pasted text everything the full email carries after the greeting', () => {
    const work = shareEmailWorkText(input);
    expect(work).toContain(input.url);
    expect(work).toContain(SKETCH.trimEnd());
    expect(buildShareEmail(input).body.endsWith(work)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation & file name
// ---------------------------------------------------------------------------

describe('isValidEmail', () => {
  it('accepts normal school addresses', () => {
    for (const ok of ['teacher@school.edu', 'j.dupont@lycee-example.edu.lb', 'mr.smith+robotics@school.org', 'T_Nguyen@Sub.School.EDU']) {
      expect(isValidEmail(ok), ok).toBe(true);
    }
  });

  it('rejects anything that could add recipients or link parameters', () => {
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
      "o'neil@b.c",
      'a@@b.c',
      'a@b.c\nbcc@x.y',
      `${'a'.repeat(250)}@b.cd`,
    ];
    for (const text of bad) expect(isValidEmail(text), JSON.stringify(text)).toBe(false);
  });
});

describe('inoFileName', () => {
  it('names the file after the student, keeping only letters, digits and _', () => {
    expect(inoFileName()).toBe('zero1_sketch.ino');
    expect(inoFileName('   ')).toBe('zero1_sketch.ino');
    expect(inoFileName('محمد')).toBe('zero1_sketch.ino');
    expect(inoFileName('Alex Dupont')).toBe('zero1_Alex_Dupont.ino');
    expect(inoFileName('Élise-Marie O\'Neil')).toBe('zero1_Elise_Marie_O_Neil.ino');
    expect(inoFileName('../../etc/passwd')).toBe('zero1_etc_passwd.ino');
    const long = inoFileName('abcdefghij '.repeat(10));
    expect(long).toMatch(/^zero1_[A-Za-z0-9_]{1,40}\.ino$/);
    expect(long.endsWith('_.ino')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

describe('share dialog', () => {
  function setup(extra: ShareDialogOptions = {}) {
    const spies = {
      openUrl: vi.fn<(url: string, target: '_blank' | '_self') => void>(),
      copyText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
      toast: vi.fn<(text: string) => void>(),
      download: vi.fn<(filename: string, text: string) => void>(),
    };
    const dialog = createShareDialog(mount(), { ...spies, ...extra });
    const el = dialog.element;
    const q = <T extends HTMLElement>(selector: string): T => el.querySelector<T>(selector)!;
    return {
      dialog,
      spies,
      email: q<HTMLInputElement>('#z1-share-email'),
      name: q<HTMLInputElement>('#z1-share-name'),
      link: q<HTMLInputElement>('#z1-share-url'),
      error: q<HTMLElement>('#z1-share-email-error'),
      status: q<HTMLElement>('[data-role="status"]'),
      click: (action: string) => q<HTMLButtonElement>(`[data-action="${action}"]`).click(),
    };
  }

  const payload = { url: URL_CODE, code: SKETCH, kind: 'code' as const };

  it('is labelled by its heading, labels every field and shows the link when opened', () => {
    const { dialog, link } = setup();
    expect(dialog.isOpen()).toBe(false);
    dialog.open(payload);
    expect(dialog.isOpen()).toBe(true);
    const el = dialog.element;
    expect(el.tagName).toBe('DIALOG');
    expect(el.querySelector(`#${el.getAttribute('aria-labelledby')}`)!.textContent).toBe('Share your work');
    expect(link.value).toBe(URL_CODE);
    expect(link.readOnly).toBe(true);
    for (const input of el.querySelectorAll('input')) {
      expect(el.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
    const email = el.querySelector<HTMLInputElement>('#z1-share-email')!;
    expect(email.type).toBe('email');
    expect(email.autocomplete).toBe('email');
    // An empty teacher address is where the student starts typing.
    expect(document.activeElement).toBe(email);
  });

  it('shows an error and opens nothing when the teacher email is missing or invalid', () => {
    const { dialog, spies, email, error, click } = setup();
    dialog.open(payload);
    click('send-gmail');
    expect(error.textContent).toContain("teacher's email");
    expect(email.getAttribute('aria-invalid')).toBe('true');

    for (const bad of ['a@b.c?cc=x', 'a@b.c&bcc=x', 'a b@c.d', 'x', 'a@b']) {
      email.value = bad;
      for (const action of ['send-gmail', 'send-outlook', 'send-mailto', 'copy-email']) click(action);
      expect(error.textContent).toContain('does not look like an email address');
      expect(document.activeElement).toBe(email);
    }
    expect(spies.openUrl).not.toHaveBeenCalled();
    expect(spies.copyText).not.toHaveBeenCalled();
    expect(localStorage.getItem(TEACHER_EMAIL_STORAGE_KEY)).toBeNull();

    // Typing again clears the error.
    email.value = 'teacher@school.edu';
    email.dispatchEvent(new Event('input'));
    expect(error.textContent).toBe('');
    expect(email.hasAttribute('aria-invalid')).toBe(false);
  });

  it('opens the provider compose link with the full email', () => {
    const { dialog, spies, email, name, status, click } = setup();
    dialog.open(payload);
    email.value = '  teacher@school.edu ';
    name.value = 'Alex';
    const expected = buildShareEmail({ ...payload, studentName: 'Alex' });

    click('send-gmail');
    expect(spies.openUrl).toHaveBeenLastCalledWith(
      composeEmailUrl('gmail', 'teacher@school.edu', expected.subject, expected.body),
      '_blank',
    );
    expect(status.textContent).toContain('Gmail opened in a new tab');
    expect(spies.toast).toHaveBeenLastCalledWith(status.textContent);

    click('send-outlook');
    expect(spies.openUrl).toHaveBeenLastCalledWith(
      composeEmailUrl('outlook', 'teacher@school.edu', expected.subject, expected.body),
      '_blank',
    );

    click('send-mailto');
    const [url, target] = spies.openUrl.mock.lastCall!;
    expect(target).toBe('_self');
    expect(url.startsWith('mailto:teacher@school.edu?subject=ZERO1%20sketch%20from%20Alex&body=Hello%2C%0D%0A')).toBe(true);
    expect(spies.openUrl).toHaveBeenCalledTimes(3);
    expect(spies.copyText).not.toHaveBeenCalled();
  });

  it('copies the work to the clipboard when it is too long for any email link', async () => {
    const { dialog, spies, email, status, click } = setup();
    const huge = { url: `https://example.org/#code=${'x'.repeat(20000)}`, code: 'int a;\n'.repeat(3000), kind: 'code' as const };
    dialog.open(huge);
    email.value = 'teacher@school.edu';
    click('send-gmail');
    const [url] = spies.openUrl.mock.lastCall!;
    expect(url.length).toBeLessThanOrEqual(WEBMAIL_URL_BUDGET);
    expect(spies.copyText).toHaveBeenCalledWith(shareEmailWorkText(huge));
    await Promise.resolve();
    expect(status.textContent).toContain('too long for an email link');
    expect(status.textContent).toContain('Ctrl+V');
  });

  it('remembers the teacher email and the student name for the next time', () => {
    const first = setup();
    first.dialog.open(payload);
    first.email.value = 'teacher@school.edu';
    first.name.value = 'Alex';
    first.click('send-outlook');
    expect(localStorage.getItem(TEACHER_EMAIL_STORAGE_KEY)).toBe('teacher@school.edu');
    expect(localStorage.getItem(STUDENT_NAME_STORAGE_KEY)).toBe('Alex');

    // A later edit is saved when the field changes, without sending.
    first.name.value = 'Alex D.';
    first.name.dispatchEvent(new Event('change'));
    expect(localStorage.getItem(STUDENT_NAME_STORAGE_KEY)).toBe('Alex D.');

    const second = setup();
    second.dialog.open(payload);
    expect(second.email.value).toBe('teacher@school.edu');
    expect(second.name.value).toBe('Alex D.');
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

  it('copies the whole email as text', async () => {
    const { dialog, spies, email, name, status, click } = setup();
    dialog.open({ ...payload, kind: 'blocks' });
    email.value = 'teacher@school.edu';
    name.value = 'Sam';
    click('copy-email');
    const { subject, body } = buildShareEmail({ ...payload, kind: 'blocks', studentName: 'Sam' });
    expect(subject).toBe('ZERO1 blocks program from Sam');
    expect(spies.copyText).toHaveBeenCalledWith(`To: teacher@school.edu\nSubject: ${subject}\n\n${body}`);
    await Promise.resolve();
    expect(status.textContent).toContain('Email text copied');
    expect(spies.openUrl).not.toHaveBeenCalled();
  });

  it('downloads the sketch as an .ino file named after the student', () => {
    const { dialog, spies, name, click } = setup();
    dialog.open(payload);
    click('download');
    expect(spies.download).toHaveBeenLastCalledWith('zero1_sketch.ino', SKETCH);
    name.value = 'Élise Martin';
    click('download');
    expect(spies.download).toHaveBeenLastCalledWith('zero1_Elise_Martin.ino', SKETCH);
  });

  it('closes with the Close button and does not submit on Enter', () => {
    const { dialog, click } = setup();
    dialog.open(payload);
    const submit = new Event('submit', { cancelable: true });
    dialog.element.querySelector('form')!.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(dialog.isOpen()).toBe(true);
    click('close');
    expect(dialog.isOpen()).toBe(false);
  });
});
