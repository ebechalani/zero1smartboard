/**
 * Email relay tests: tools/email-relay/Code.gs (the Google Apps Script web
 * app that emails a student's work to the teacher, docs/EMAIL.md) evaluated
 * in Node with fakes for the Google services it uses (MailApp, Session,
 * LockService, CacheService, ContentService, Utilities), and driven end to
 * end through doPost / doGet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeShareCode } from '../src/ui/editor';
import { CODE_MAX_LENGTH, LINK_MAX_LENGTH, MESSAGE_MAX_LENGTH, NAME_MAX_LENGTH } from '../src/ui/share-dialog';
import { sketchFileName } from '../src/ui/sketch-file';

const SOURCE = readFileSync(join(__dirname, '..', 'tools', 'email-relay', 'Code.gs'), 'utf8');

const SIM = 'https://ebechalani.github.io/zero1smartboard/';
const LINK = `${SIM}#code=dm9pZCBzZXR1cCgpIHt9`;
const SKETCH = 'void setup() {\n  pinMode(A1, OUTPUT);\n}\n\nvoid loop() {\n  if (a < b && c > d) Serial.println("x");\n}\n';
const OWNER = 'owner@gmail.com';

/** The SETTINGS a test can change (see the top of Code.gs). */
interface Settings {
  ALLOWED_DOMAINS?: string[];
  ALLOWED_ADDRESSES?: string[];
  SIMULATOR_URL?: string;
  DEV?: boolean;
  MAX_EMAILS_PER_HOUR?: number;
}

/** What the fake MailApp.sendEmail received. */
interface SentEmail {
  to: string;
  subject: string;
  body: string;
  htmlBody: string;
  name: string;
  attachments: { data: string; contentType: string; name: string }[];
}

interface RelayAnswer {
  ok: boolean;
  error?: string;
  message?: string;
  service?: string;
}

/** The relay's functions (the ones ending in "_" are its pure helpers). */
interface Relay {
  doPost(e: unknown): { text: string; mimeType: string | null };
  doGet(): { text: string; mimeType: string | null };
  sendTestEmail(): RelayAnswer;
  isValidAddress_(value: unknown): boolean;
  isRecipientAllowed_(address: string, domains: string[], addresses: string[], owner: string): boolean;
  isSimulatorLink_(link: unknown, simulatorUrl: string, allowLocalhost: boolean): boolean;
  cleanName_(value: unknown): string;
  cleanMessage_(value: unknown): string;
  escapeHtml_(text: string): string;
  utf8Length_(text: string): number;
}

/** Replace SETTINGS lines of the script (each must exist exactly as `const NAME = ...;`). */
function withSettings(source: string, settings: Settings): string {
  let out = source;
  for (const [name, value] of Object.entries(settings)) {
    const line = new RegExp(`^const ${name} = .*;$`, 'm');
    expect(line.test(out), name).toBe(true);
    out = out.replace(line, `const ${name} = ${JSON.stringify(value)};`);
  }
  return out;
}

/** Evaluate Code.gs with fake Google services. */
function loadRelay(settings: Settings = {}) {
  const sent: SentEmail[] = [];
  const cache = new Map<string, string>();
  const state = {
    quota: 100,
    owner: OWNER as string,
    lockFree: true,
    sendError: null as Error | null,
    cacheError: null as Error | null,
  };
  const logs: string[] = [];
  const fakes: Record<string, unknown> = {
    MailApp: {
      sendEmail: (message: SentEmail) => {
        if (state.sendError) throw state.sendError;
        sent.push(message);
        state.quota -= 1;
      },
      getRemainingDailyQuota: () => state.quota,
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => state.owner }) },
    LockService: { getScriptLock: () => ({ tryLock: () => state.lockFree, releaseLock: () => {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => {
          if (state.cacheError) throw state.cacheError;
          return cache.get(key) ?? null;
        },
        put: (key: string, value: string, seconds: number) => {
          expect(seconds).toBeLessThanOrEqual(21600); // CacheService's longest expiration
          cache.set(key, value);
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({
        text,
        mimeType: null as string | null,
        setMimeType(type: string) {
          this.mimeType = type;
          return this;
        },
      }),
    },
    Utilities: {
      newBlob: (data: string, contentType: string, name: string) => ({ data, contentType, name }),
    },
    console: { log: (text: string) => logs.push(text), warn: (text: string) => logs.push(text), error: (text: string) => logs.push(text) },
  };
  const exported = [
    'doPost',
    'doGet',
    'sendTestEmail',
    'isValidAddress_',
    'isRecipientAllowed_',
    'isSimulatorLink_',
    'cleanName_',
    'cleanMessage_',
    'escapeHtml_',
    'utf8Length_',
  ];
  const names = Object.keys(fakes);
  const factory = new Function(...names, `${withSettings(SOURCE, settings)}\nreturn { ${exported.join(', ')} };`);
  const relay = factory(...names.map((n) => fakes[n])) as Relay;

  /** POST a body (an object is sent as JSON text) and decode the JSON answer. */
  const post = (body: unknown): RelayAnswer => {
    const contents = typeof body === 'string' ? body : JSON.stringify(body);
    const out = relay.doPost({ postData: { contents, type: 'text/plain', length: contents.length }, parameter: {} });
    expect(out.mimeType).toBe('application/json');
    return JSON.parse(out.text) as RelayAnswer;
  };
  return { relay, post, sent, state, cache, fakes, logs };
}

function request(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    to: 'teacher@myschool.edu',
    studentName: 'Alex Dupont',
    message: '',
    kind: 'code',
    link: LINK,
    code: SKETCH,
    fileName: 'zero1_Alex_Dupont_0926_143205.ino',
    ...extra,
  };
}

const SCHOOL: Settings = { ALLOWED_DOMAINS: ['myschool.edu'] };

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 26, 10, 0, 0) });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('settings', () => {
  it('ships with the safe defaults: owner only, the real simulator URL, DEV off', () => {
    const value = (name: string): string => new RegExp(`^const ${name} = (.*);$`, 'm').exec(SOURCE)![1];
    expect(value('ALLOWED_DOMAINS')).toBe('[]');
    expect(value('ALLOWED_ADDRESSES')).toBe('[]');
    expect(value('SIMULATOR_URL')).toBe(`'${SIM}'`);
    expect(value('DEV')).toBe('false');
    expect(Number(value('MAX_EMAILS_PER_HOUR'))).toBeGreaterThan(0);
    expect(value('SENDER_NAME')).toBe("'ZERO1 Simulator'");
    // The SETTINGS block comes first, before any function.
    expect(SOURCE.indexOf('SETTINGS')).toBeLessThan(SOURCE.indexOf('function '));
  });

  it('uses the same field limits as the simulator', () => {
    const limit = (name: string): number => Number(new RegExp(`^const ${name} = (\\d+);$`, 'm').exec(SOURCE)![1]);
    expect(limit('MAX_NAME_LENGTH_')).toBe(NAME_MAX_LENGTH);
    expect(limit('MAX_MESSAGE_LENGTH_')).toBe(MESSAGE_MAX_LENGTH);
    expect(limit('MAX_LINK_LENGTH_')).toBe(LINK_MAX_LENGTH);
    expect(limit('MAX_CODE_LENGTH_')).toBe(CODE_MAX_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

describe('doPost: sending', () => {
  it('emails the name, message, link and code, with the sketch attached', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const answer = post(
      request({
        studentName: 'Alex <b>Dupont</b>',
        message: 'Hello Miss,\r\n<script>alert(1)</script> & "done"',
      }),
    );
    expect(answer).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    const email = sent[0];
    expect(email.to).toBe('teacher@myschool.edu');
    expect(email.subject).toBe('ZERO1 sketch from Alex <b>Dupont</b>');
    expect(email.name).toBe('ZERO1 Simulator');

    // Plain text: everything as typed.
    expect(email.body).toContain('Alex <b>Dupont</b> sent you a sketch from the ZERO1 Smart Board simulator.');
    expect(email.body).toContain('Message from Alex <b>Dupont</b>:\nHello Miss,\n<script>alert(1)</script> & "done"\n');
    expect(email.body).toContain(`Open it in the simulator:\n${LINK}\n`);
    const lines = email.body.split('\n');
    const first = lines.findIndex((l) => /^-{10,}$/.test(l));
    const last = lines.lastIndexOf(lines[first]);
    expect(lines[first - 1]).toBe('Arduino code:');
    expect(lines.slice(first + 1, last).join('\n')).toBe(SKETCH.trimEnd());
    expect(email.body).toContain('attached as zero1_Alex_Dupont_0926_143205.ino: it opens in the Arduino IDE.');

    // HTML: every student value escaped, the link only in the href.
    const html = email.htmlBody;
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>Alex &lt;b&gt;Dupont&lt;/b&gt;</strong> sent you a sketch');
    expect(html).toContain('Hello Miss,<br>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;done&quot;');
    expect(html).toContain(`<a href="${LINK}"`);
    expect(html).toContain('>Open it in the simulator</a>');
    expect(html).toMatch(/<pre[^>]*>void setup\(\) \{\n {2}pinMode\(A1, OUTPUT\);/);
    expect(html).toContain('if (a &lt; b &amp;&amp; c &gt; d) Serial.println(&quot;x&quot;);');
    expect(html).toContain('<strong>zero1_Alex_Dupont_0926_143205.ino</strong>');
    expect(html).toContain('Arduino IDE');

    expect(email.attachments).toEqual([{ data: SKETCH, contentType: 'text/plain', name: 'zero1_Alex_Dupont_0926_143205.ino' }]);
  });

  it('says the code was generated from the blocks in Blocks mode', () => {
    const { post, sent } = loadRelay(SCHOOL);
    expect(post(request({ kind: 'blocks', studentName: 'Sam', link: `${SIM}#blocks=eyJ9` })).ok).toBe(true);
    const email = sent[0];
    expect(email.subject).toBe('ZERO1 blocks program from Sam');
    expect(email.body).toContain('Sam sent you a blocks program');
    expect(email.body).toContain('Open it in the simulator to see the blocks:');
    expect(email.body).toContain('Arduino code generated from their blocks:');
    expect(email.htmlBody).toContain('Arduino code generated from their blocks:');
    expect(email.body).toContain('The generated code is also attached as');
  });

  it('leaves out an empty message and a missing link', () => {
    const { post, sent } = loadRelay(SCHOOL);
    expect(post(request({ message: ' \n ', link: '' })).ok).toBe(true);
    expect(post(request({ message: undefined, link: undefined })).ok).toBe(true);
    for (const email of sent) {
      expect(email.body).not.toContain('Message from');
      expect(email.body).toContain('The simulator link was too long to send, so this email has the code only.');
      expect(email.htmlBody).not.toContain('<a ');
      expect(email.body).toContain(SKETCH.trimEnd());
    }
  });

  it('keeps the subject on one line and cleans invisible characters from the name and message', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const answer = post(
      request({
        studentName: '  Alex\r\nBcc: x@evil.com‮​\t Dupont ',
        message: 'line 1\r\n\r\n\r\n\r\nline 2\u0007​⁦ ok  \nend',
      }),
    );
    expect(answer.ok).toBe(true);
    expect(sent[0].subject).toBe('ZERO1 sketch from Alex Bcc: x@evil.com Dupont');
    expect(sent[0].subject).not.toMatch(/[\r\n​‮]/);
    expect(sent[0].body).toContain('line 1\n\nline 2 ok\nend');
  });

  it('shows long code as an attachment only, so the email stays under the Apps Script size limit', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const code = '// é < & >\n'.repeat(9091).slice(0, 100000);
    expect(code).toHaveLength(100000);
    expect(post(request({ code })).ok).toBe(true);
    const email = sent[0];
    expect(email.body).not.toContain('// é');
    expect(email.htmlBody).not.toContain('// é');
    expect(email.body).toContain('The code is too long to show here: it is in the attached file zero1_Alex_Dupont_0926_143205.ino');
    expect(email.attachments[0].data).toBe(code);
  });

  it('replaces any other attachment name with zero1_sketch.ino', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const names = ['../../evil.exe', 'zero1_x.ino.exe', 'zero1 x.ino', 'Zero1.ino', 'zero1_é.ino', `zero1_${'a'.repeat(41)}.ino`, 42, undefined];
    for (const fileName of names) expect(post(request({ fileName })).ok, String(fileName)).toBe(true);
    for (const email of sent) expect(email.attachments[0].name).toBe('zero1_sketch.ino');
    // Every name the simulator makes is kept.
    for (const student of ['', 'Élise Martin', 'a'.repeat(80)]) {
      const fileName = sketchFileName(student, new Date());
      expect(post(request({ fileName })).ok).toBe(true);
      expect(sent[sent.length - 1].attachments[0].name).toBe(fileName);
    }
  });

  it('sends the test email to the owner, with a link that opens the attached sketch', () => {
    const { relay, sent, logs } = loadRelay();
    expect(relay.sendTestEmail()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(OWNER);
    const link = /^Open it in the simulator:\n(.*)$/m.exec(sent[0].body)![1];
    expect(link.startsWith(`${SIM}#code=`)).toBe(true);
    expect(decodeShareCode(link.slice(`${SIM}#code=`.length))).toBe(sent[0].attachments[0].data);
    expect(logs.join('\n')).toContain(`Test email sent to ${OWNER}`);
  });
});

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

describe('doPost: bad requests', () => {
  it('rejects a missing body, bad JSON and anything but an object', () => {
    const { relay, post, sent } = loadRelay(SCHOOL);
    for (const body of ['', '{not json', '[]', 'null', '"text"', '42', `{"to": "${'x'.repeat(400001)}"}`]) {
      expect(post(body), body.slice(0, 20)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    for (const e of [undefined, null, {}, { postData: {} }, { postData: { contents: 42 } }]) {
      const out = relay.doPost(e);
      expect(JSON.parse(out.text)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(sent).toHaveLength(0);
  });

  it('requires the name, 1 to 60 characters', () => {
    const { post, sent } = loadRelay(SCHOOL);
    for (const studentName of [undefined, null, '', '   ', '​‮⁦', 42, 'x'.repeat(61)]) {
      const answer = post(request({ studentName }));
      expect(answer, String(studentName)).toMatchObject({ ok: false, error: 'bad_request' });
      expect(answer.message).toMatch(/studentName/);
    }
    expect(post(request({ studentName: 'x'.repeat(60) })).ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('checks the message, the kind and the code', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const bad: Record<string, unknown>[] = [
      { message: 'x'.repeat(501) },
      { message: 42 },
      { kind: 'python' },
      { kind: undefined },
      { code: '' },
      { code: '  \n ' },
      { code: undefined },
      { code: 'x'.repeat(100001) },
    ];
    for (const extra of bad) expect(post(request(extra)), JSON.stringify(extra).slice(0, 40)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(sent).toHaveLength(0);
    expect(post(request({ message: 'x'.repeat(500), code: 'x'.repeat(100000) })).ok).toBe(true);
  });

  it('only puts links to the simulator in the email', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const foreign = [
      'https://evil.example/#code=abc',
      'https://ebechalani.github.io/zero1smartboard.evil.example/',
      'https://ebechalani.github.io.evil.example/zero1smartboard/',
      'https://ebechalani.github.io/other/',
      'http://ebechalani.github.io/zero1smartboard/',
      'HTTPS://EBECHALANI.GITHUB.IO/zero1smartboard/',
      `javascript:alert(1)//${SIM}`,
      ` ${SIM}`,
      `${SIM}#code=" onclick="alert(1)`,
      `${SIM}#code=<script>`,
      `${SIM}\\evil`,
      `${SIM}#code=x\ny`,
      'http://localhost:5173/#code=abc', // DEV is off
      `${SIM}#code=${'A'.repeat(60000)}`,
      42,
    ];
    for (const link of foreign) {
      expect(post(request({ link })), String(link).slice(0, 60)).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(sent).toHaveLength(0);
    const longest = `${SIM}#code=${'A'.repeat(60000 - SIM.length - 6)}`;
    expect(longest).toHaveLength(60000);
    expect(post(request({ link: longest })).ok).toBe(true);
  });

  it('accepts links to http://localhost only when DEV is true', () => {
    const { post } = loadRelay({ ...SCHOOL, DEV: true });
    expect(post(request({ link: 'http://localhost:5173/#code=abc' })).ok).toBe(true);
    expect(post(request({ link: 'http://localhost/#code=abc' })).ok).toBe(true);
    expect(post(request({ link: LINK })).ok).toBe(true);
    for (const link of ['http://localhost.evil.example/', 'http://localhost@evil.example/', 'https://localhost:5173/', 'http://127.0.0.1:5173/']) {
      expect(post(request({ link })).ok, link).toBe(false);
    }
  });

  it('never lets a SIMULATOR_URL without its final slash match another host', () => {
    const { relay } = loadRelay();
    expect(relay.isSimulatorLink_('https://ebechalani.github.io.evil.example/', 'https://ebechalani.github.io', false)).toBe(false);
    expect(relay.isSimulatorLink_('https://ebechalani.github.io/zero1smartboard/#code=a', 'https://ebechalani.github.io', false)).toBe(true);
  });
});

describe('doPost: who may receive the work', () => {
  it('sends only to the exact allowed domains, whatever the case', () => {
    const { post, sent } = loadRelay({ ALLOWED_DOMAINS: ['MySchool.edu'] });
    for (const to of ['teacher@myschool.edu', 'X@MYSCHOOL.EDU', "o'neil@myschool.edu", 'mr.smith+robotics@myschool.edu', 'a_b-c@MySchool.Edu']) {
      expect(post(request({ to })), to).toEqual({ ok: true });
    }
    expect(sent.map((e) => e.to)).toContain("o'neil@myschool.edu");
    for (const to of ['x@myschool.edu.evil.com', 'x@evilmyschool.edu', 'x@sub.myschool.edu', 'x@myschool.education', 'x@myschool.ed']) {
      expect(post(request({ to })), to).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
    }
    expect(sent).toHaveLength(5);
  });

  it('refuses every trick that could smuggle in another recipient', () => {
    const { post, sent } = loadRelay(SCHOOL);
    const tricks = [
      '"x@evil.com"@myschool.edu',
      '"x"@myschool.edu',
      'x\\@evil.com@myschool.edu',
      'x@evil.com@myschool.edu',
      'x@myschool.edu@evil.com',
      'x@evil.com,y@myschool.edu',
      'x@evil.com;y@myschool.edu',
      'y@myschool.edu,x@evil.com',
      'Evil <x@evil.com>, y@myschool.edu',
      'x@evil.com <y@myschool.edu>',
      '<x@evil.com>y@myschool.edu',
      '(x@evil.com)y@myschool.edu',
      'y@myschool.edu(x@evil.com)',
      'x%evil.com@myschool.edu',
      'evil.com!x@myschool.edu',
      'x@myschool.edu\n',
      'x@myschool.edu\r\nBcc: x@evil.com',
      ' x@myschool.edu',
      'x@myschool.edu.',
      'x@.myschool.edu',
      '.x@myschool.edu',
      'x..y@myschool.edu',
      'x@myschool..edu',
      'x@-myschool.edu',
      'x@myschool.edu​',
      'x\u0000@myschool.edu',
      'x@myschооl.edu', // Cyrillic о
      'x@[127.0.0.1]',
      'x@myschool.edu%40evil.com',
      `${'a'.repeat(65)}@myschool.edu`,
      `a@${`${'b'.repeat(63)}.`.repeat(4)}myschool.edu`, // longer than 254 characters
      '',
      42,
      ['x@myschool.edu'],
      { to: 'x@myschool.edu' },
    ];
    for (const to of tricks) {
      const answer = post(request({ to }));
      expect(answer.ok, JSON.stringify(to)).toBe(false);
      expect(['bad_request', 'recipient_not_allowed']).toContain(answer.error);
    }
    expect(sent).toHaveLength(0);
  });

  it('lets a subdomain in only when it is listed', () => {
    const { post } = loadRelay({ ALLOWED_DOMAINS: [' @Staff.MySchool.edu ', 'myschool.edu'] });
    expect(post(request({ to: 'x@staff.myschool.edu' })).ok).toBe(true);
    expect(post(request({ to: 'x@other.myschool.edu' }))).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
  });

  it('sends to the exact allowed addresses', () => {
    const { post } = loadRelay({ ALLOWED_ADDRESSES: ['J.Smith@gmail.com'] });
    expect(post(request({ to: 'j.smith@gmail.com' })).ok).toBe(true);
    expect(post(request({ to: 'J.SMITH@GMAIL.COM' })).ok).toBe(true);
    for (const to of ['j.smith2@gmail.com', 'smith@gmail.com', 'x@gmail.com', 'teacher@myschool.edu']) {
      expect(post(request({ to })), to).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
    }
  });

  it('sends only to the script owner when both lists are empty (the default)', () => {
    const { post, sent, state } = loadRelay();
    expect(post(request({ to: OWNER }))).toEqual({ ok: true });
    expect(post(request({ to: 'Owner@Gmail.com' }))).toEqual({ ok: true });
    expect(post(request({ to: 'teacher@myschool.edu' }))).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
    expect(post(request({ to: 'owner@gmail.co' }))).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
    expect(sent).toHaveLength(2);
    // Without a known owner nobody can receive anything.
    state.owner = '';
    expect(post(request({ to: OWNER }))).toMatchObject({ ok: false, error: 'recipient_not_allowed' });
  });

  it('always allows the owner, also next to the lists', () => {
    const { post } = loadRelay(SCHOOL);
    expect(post(request({ to: OWNER })).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Limits and failures
// ---------------------------------------------------------------------------

describe('doPost: limits and failures', () => {
  it(`stops after MAX_EMAILS_PER_HOUR emails in an hour`, () => {
    const { post, sent } = loadRelay({ ...SCHOOL, MAX_EMAILS_PER_HOUR: 3 });
    for (let i = 0; i < 3; i++) expect(post(request())).toEqual({ ok: true });
    // Refused requests do not count.
    expect(post(request({ to: 'x@evil.com' })).ok).toBe(false);
    expect(post(request())).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(sent).toHaveLength(3);

    vi.setSystemTime(new Date(2026, 8, 26, 11, 0, 0));
    expect(post(request())).toEqual({ ok: true });
    expect(sent).toHaveLength(4);
  });

  it('uses the shipped hourly limit', () => {
    const limit = Number(/^const MAX_EMAILS_PER_HOUR = (\d+);$/m.exec(SOURCE)![1]);
    const { post, sent } = loadRelay(SCHOOL);
    for (let i = 0; i < limit; i++) expect(post(request()).ok).toBe(true);
    expect(post(request())).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(sent).toHaveLength(limit);
  });

  it('answers rate_limited when the lock cannot be taken, and still sends when the cache fails', () => {
    const { post, sent, state } = loadRelay(SCHOOL);
    state.lockFree = false;
    expect(post(request())).toMatchObject({ ok: false, error: 'rate_limited' });
    state.lockFree = true;
    state.cacheError = new Error('cache down');
    expect(post(request())).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
  });

  it('answers quota_exceeded when the daily email quota is used up', () => {
    const { post, sent, state, cache } = loadRelay(SCHOOL);
    state.quota = 0;
    expect(post(request())).toMatchObject({ ok: false, error: 'quota_exceeded' });
    expect(sent).toHaveLength(0);
    expect(cache.size).toBe(0); // no hourly slot used
  });

  it('answers send_failed when MailApp throws', () => {
    const { post, state, logs } = loadRelay(SCHOOL);
    state.sendError = new Error('Service invoked too many times for one day: email.');
    const answer = post(request());
    expect(answer).toMatchObject({ ok: false, error: 'send_failed' });
    expect(answer.message).toContain('Service invoked too many times');
    expect(logs.join('\n')).toContain('send_failed');
  });

  it('never throws out of doPost', () => {
    const { relay, fakes } = loadRelay(SCHOOL);
    (fakes.LockService as { getScriptLock(): unknown }).getScriptLock = () => {
      throw new Error('LockService unavailable');
    };
    const out = relay.doPost({ postData: { contents: JSON.stringify(request()) } });
    expect(JSON.parse(out.text)).toMatchObject({ ok: false, error: 'send_failed' });
  });
});

describe('doGet', () => {
  it('answers a small JSON so the teacher can check the URL in a browser', () => {
    const { relay } = loadRelay();
    const out = relay.doGet();
    expect(out.mimeType).toBe('application/json');
    expect(JSON.parse(out.text)).toEqual({ ok: true, service: 'zero1-email-relay' });
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('helpers', () => {
  it('escapes everything HTML gives a meaning to', () => {
    const { relay } = loadRelay();
    expect(relay.escapeHtml_(`<a href="x" title='y'>&amp;</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;amp;&lt;/a&gt;');
  });

  it('counts UTF-8 bytes', () => {
    const { relay } = loadRelay();
    expect(relay.utf8Length_('abc')).toBe(3);
    expect(relay.utf8Length_('é°')).toBe(4);
    expect(relay.utf8Length_('✓')).toBe(3);
    expect(relay.utf8Length_('🌡')).toBe(4);
    expect(relay.utf8Length_('\ud800')).toBe(3);
  });

  it('cleans names and messages', () => {
    const { relay } = loadRelay();
    expect(relay.cleanName_(' Élise \n\t Martin‍ ')).toBe('Élise Martin');
    expect(relay.cleanName_(42)).toBe('');
    expect(relay.cleanMessage_('a\r\nb\rc d e')).toBe('a\nb\nc d e');
    expect(relay.cleanMessage_(null)).toBe('');
  });

  it('checks addresses and recipients without the web app', () => {
    const { relay } = loadRelay();
    expect(relay.isValidAddress_('teacher@school.edu')).toBe(true);
    expect(relay.isValidAddress_('teacher@school')).toBe(false);
    expect(relay.isRecipientAllowed_('a@b.edu', ['b.edu'], [], '')).toBe(true);
    expect(relay.isRecipientAllowed_('a@c.b.edu', ['b.edu'], [], '')).toBe(false);
    expect(relay.isRecipientAllowed_('a@b.edu', [], [], '')).toBe(false);
  });
});
