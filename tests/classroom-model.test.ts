/**
 * src/classroom/model.ts (docs/CLASSROOM.md §4.4, §7.2): class codes, student names, text
 * cleaning, device labels, the document readers, and the sync of LIMITS with firestore.rules.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLASS_CODE_ALPHABET,
  CLASS_SCHEMA,
  LIMITS,
  NAME_PATTERN,
  classLink,
  cleanLine,
  cleanName,
  codeProblem,
  contentOf,
  deviceLabel,
  draftProblem,
  formatClassCode,
  fullName,
  generateClassCode,
  listName,
  nameKeyOf,
  nameProblem,
  newHandinId,
  normalizeClassCode,
  readClassDoc,
  readHandinDoc,
  readMemberDoc,
  shortDeviceId,
  utf8Length,
} from '../src/classroom/model';

/** A byte source that hands out the scripted values in order, then zeros. */
function scripted(values: number[]): (n: number) => Uint8Array {
  const queue = [...values];
  return (n) => Uint8Array.from({ length: n }, () => queue.shift() ?? 0);
}

describe('class codes', () => {
  it('normalizes case, separators and look-alike digits', () => {
    expect(normalizeClassCode('bkt-4m9 ')).toBe('BKT4M9');
    expect(normalizeClassCode(' BKT 4M9')).toBe('BKT4M9');
    expect(normalizeClassCode('bkt.4m9')).toBe('BKT4M9');
    expect(normalizeClassCode('bkt_4m9')).toBe('BKT4M9');
    expect(normalizeClassCode('8KT4M9')).toBe('BKT4M9');
    expect(normalizeClassCode('2KT4M9')).toBe('ZKT4M9');
    expect(normalizeClassCode('5KT4M9')).toBe('SKT4M9');
    expect(normalizeClassCode('6KT4M9')).toBe('GKT4M9');
  });
  it('refuses vowels, 0, 1, Y, wrong lengths and empty input', () => {
    for (const bad of ['BAT4M9', 'BKT0M9', 'BKT1M9', 'BKTYM9', 'BKT4M', 'BKT4M9X', '', 'B!T4M9', 'BKT4M9 BKT4M9']) {
      expect(normalizeClassCode(bad), bad).toBeNull();
    }
  });
  it('names the first bad character', () => {
    expect(codeProblem('BAT4M9')).toBe('Class codes never contain the letter A.');
    expect(codeProblem('bkt0m9')).toBe('Class codes never contain the digit 0.');
    expect(codeProblem('BKT1M9')).toBe('Class codes never contain the digit 1.');
    expect(codeProblem('B!T4M9')).toContain('"!"');
    expect(codeProblem('BKT4M')).toBe('A class code has 6 characters, not 5.');
    expect(codeProblem('')).toBe('Type the class code your teacher gave you.');
    expect(codeProblem('bkt-4m9')).toBeNull();
  });
  it('formats and links', () => {
    expect(formatClassCode('BKT4M9')).toBe('BKT-4M9');
    expect(classLink('BKT4M9', 'https://ebechalani.github.io/zero1smartboard/index.html')).toBe('https://ebechalani.github.io/zero1smartboard/#class=BKT4M9');
    expect(classLink('BKT4M9', 'https://ebechalani.github.io/zero1smartboard/teacher.html?x=1#y')).toBe('https://ebechalani.github.io/zero1smartboard/#class=BKT4M9');
    expect(classLink('BKT4M9', 'http://localhost:5173/')).toBe('http://localhost:5173/#class=BKT4M9');
  });
  it('generates codes from the alphabet only, uniformly', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 24_000; i++) {
      const code = generateClassCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$/);
      for (const ch of code) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const expected = (24_000 * 6) / CLASS_CODE_ALPHABET.length;
    for (const ch of CLASS_CODE_ALPHABET) {
      expect(counts.get(ch) ?? 0, ch).toBeGreaterThan(expected * 0.85);
      expect(counts.get(ch) ?? 0, ch).toBeLessThan(expected * 1.15);
    }
  });
  it('rejects bytes of 240 and above instead of folding them (no modulo bias)', () => {
    expect(generateClassCode(scripted([255, 0, 1, 2, 3, 4, 240, 5]))).toBe('BCDFGH');
    expect(generateClassCode(scripted([240, 24, 48, 72, 96, 120, 144]))).toBe('BBBBBB');
  });
});

describe('ids', () => {
  it('handinId: 20 × [A-Za-z0-9]; bytes ≥ 248 are rejected', () => {
    expect(newHandinId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(new Set(Array.from({ length: 50 }, () => newHandinId())).size).toBe(50);
    expect(newHandinId(scripted([255, 248, ...Array(20).fill(0)]))).toBe('A'.repeat(20));
  });
});

describe('student names', () => {
  it('cleans a typed name: NFC, one line, single spaces, at most 30 characters', () => {
    expect(cleanName('  Ali   Khoury ')).toBe('Ali Khoury');
    expect(cleanName('Élise')).toBe('Élise'); // NFD → NFC
    expect(cleanName('Ali\nKhoury')).toBe('Ali Khoury');
    expect(cleanName('x'.repeat(40))).toHaveLength(30);
  });
  it.each([
    ['Ali', null],
    ['Élise', null],
    ['محمد', null],
    ["O'Neil-Dupont Jr.", null],
    ['Ali Ben Salah', null],
    ['x'.repeat(30), null],
    ['', 'empty'],
    ['x'.repeat(31), 'too_long'],
    ['Ali2', 'invalid'],
    ['-Ali', 'invalid'],
    ['ali@k', 'invalid'],
    ['<b>x</b>', 'invalid'],
  ])('nameProblem(%j) = %j', (name, problem) => {
    expect(nameProblem(name)).toBe(problem);
  });
  it('makes the grouping key and the display names', () => {
    expect(nameKeyOf('Ali', 'Khoury')).toBe('ali khoury');
    expect(nameKeyOf('Élise', "O'Neil")).toBe("élise o'neil");
    expect(fullName('Ali', 'Khoury')).toBe('Ali Khoury');
    expect(listName('Ali', 'Khoury')).toBe('Khoury, Ali');
    expect(listName('Ali', '')).toBe('Ali');
  });
});

describe('text cleaning', () => {
  it('cleanLine: one line, single spaces, no invisible characters, cut without half an emoji', () => {
    expect(cleanLine('  Alex \n\t Dupont​ ', 60)).toBe('Alex Dupont');
    expect(cleanLine('Alex\r\nBcc: x@evil.com', 60)).toBe('Alex Bcc: x@evil.com');
    expect(cleanLine('‮‍', 60)).toBe('');
    expect(cleanLine('x'.repeat(80), 60)).toHaveLength(60);
    expect(cleanLine(`${'x'.repeat(59)}🙂`, 60)).toBe('x'.repeat(59));
    expect(cleanLine(`${'x'.repeat(58)}🙂`, 60)).toBe(`${'x'.repeat(58)}🙂`);
  });
  it('utf8Length counts bytes', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('🙂')).toBe(4);
    expect(utf8Length('')).toBe(0);
  });
});

describe('devices', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome · Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', 'Edge · Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari · macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome · macOS'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome · ChromeOS'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36', 'Chrome · Android'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36', 'Samsung Internet · Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari · iOS'],
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1', 'Chrome · iOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15', 'Firefox · iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox · Linux'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', 'Chrome · Linux'],
    ['curl/8.0', 'Unknown browser'],
    ['', 'Unknown browser'],
  ])('labels %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
    expect(deviceLabel(ua).length).toBeLessThanOrEqual(LIMITS.deviceMax);
  });
  it('short device id', () => {
    expect(shortDeviceId('abcdefgh1234wxyz')).toBe('WXYZ');
    expect(shortDeviceId('ab')).toBe('AB');
  });
});

describe('draftProblem', () => {
  const draft = { kind: 'code' as const, code: 'void setup() {}', workspaceJson: '', python: '' };
  it('finds empty and oversize drafts', () => {
    expect(draftProblem(draft)).toBeNull();
    expect(draftProblem({ ...draft, code: '  \n' })).toBe('empty_sketch');
    expect(draftProblem({ ...draft, code: 'x'.repeat(50_001) })).toBe('too_large');
    expect(draftProblem({ ...draft, code: 'é'.repeat(25_001) })).toBe('too_large');
    expect(draftProblem({ ...draft, code: 'x'.repeat(50_000) })).toBeNull();
    expect(draftProblem({ ...draft, kind: 'blocks', workspaceJson: 'x'.repeat(100_001) })).toBe('too_large');
  });
  it('checks the program of a Python draft (docs/PYTHON.md §8.1)', () => {
    const python = { ...draft, kind: 'python' as const, python: 'print("hi")\n' };
    expect(draftProblem(python)).toBeNull();
    expect(draftProblem({ ...python, python: ' \n' })).toBe('empty_sketch');
    expect(draftProblem({ ...python, python: 'x'.repeat(LIMITS.pythonMaxBytes) })).toBeNull();
    expect(draftProblem({ ...python, python: 'x'.repeat(50_001) })).toBe('too_large');
    expect(draftProblem({ ...python, python: 'é'.repeat(25_001) })).toBe('too_large');
    expect(draftProblem({ ...python, code: '' })).toBe('empty_sketch'); // the sketch (or placeholder) is still required
  });
});

describe('document readers', () => {
  const ts = (ms: number) => ({ toDate: () => new Date(ms) });
  it('reads a class doc with tolerant types', () => {
    const cls = readClassDoc({ ownerUid: 'tA', name: '8B', handinsOpen: 'yes', keepWeeks: 10, deleting: false, createdAt: ts(3000), updatedAt: null });
    expect(cls).toEqual({ ownerUid: 'tA', name: '8B', handinsOpen: false, keepWeeks: 10, deleting: false, createdAt: new Date(3000), updatedAt: null });
    expect(readClassDoc({}).keepWeeks).toBe(LIMITS.keepWeeksMin);
    expect(readClassDoc({ name: 12 }).name).toBe('12');
  });
  it('reads member and hand-in docs, with Bytes as Uint8Array', () => {
    expect(readMemberDoc({ firstName: 'Ali', lastName: 'Khoury', nameKey: 'ali khoury', device: 'd', joinedAt: ts(5), handinCount: 2, lastHandinAt: null, lastHandinId: '' })).toEqual({
      firstName: 'Ali',
      lastName: 'Khoury',
      nameKey: 'ali khoury',
      device: 'd',
      joinedAt: new Date(5),
      handinCount: 2,
      lastHandinAt: null,
      lastHandinId: '',
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const record = readHandinDoc('H1', 'BKT4M9', {
      uid: 'u',
      firstName: 'Ali',
      lastName: 'Khoury',
      nameKey: 'ali khoury',
      kind: 'blocks',
      createdAt: ts(7),
      enc: 'gzip',
      code: { toUint8Array: () => bytes },
      workspace: { toUint8Array: () => new Uint8Array(0) },
    });
    expect(record).toMatchObject({ id: 'H1', classCode: 'BKT4M9', uid: 'u', firstName: 'Ali', lastName: 'Khoury', nameKey: 'ali khoury', kind: 'blocks' });
    expect(record.content).toEqual({ enc: 'gzip', code: bytes, workspace: new Uint8Array(0) });
    expect(record.createdAt?.getTime()).toBe(7);
    expect(readHandinDoc('H2', 'BKT4M9', { enc: 'plain', code: 'x', workspace: '' }).content).toEqual({ enc: 'plain', code: 'x', workspace: '' });
  });
  it('reads the three kinds; anything else (an unknown or missing kind) as Code', () => {
    const kindOf = (kind: unknown) => readHandinDoc('H3', 'BKT4M9', { kind, enc: 'plain', code: 'x', workspace: '' }).kind;
    expect(kindOf('code')).toBe('code');
    expect(kindOf('blocks')).toBe('blocks');
    expect(kindOf('python')).toBe('python');
    for (const other of ['pyth0n', 'Python', 'micropython', '', 7, null, undefined, ['python']]) expect(kindOf(other), String(other)).toBe('code');
    const python = readHandinDoc('H4', 'BKT4M9', { kind: 'python', enc: 'plain', code: 'void setup() {}', workspace: 'print("hi")\n' });
    expect(python.content).toEqual({ enc: 'plain', code: 'void setup() {}', workspace: 'print("hi")\n' });
  });
});

describe('contentOf', () => {
  const decoded = { code: 'void setup() {}\n', workspaceJson: 'the stored workspace' };
  it('puts the stored workspace under the field of its kind (docs/PYTHON.md §8.1)', () => {
    expect(contentOf('code', decoded)).toEqual({ kind: 'code', code: decoded.code, workspaceJson: '', python: '' });
    expect(contentOf('blocks', decoded)).toEqual({ kind: 'blocks', code: decoded.code, workspaceJson: 'the stored workspace', python: '' });
    expect(contentOf('python', decoded)).toEqual({ kind: 'python', code: decoded.code, workspaceJson: '', python: 'the stored workspace' });
  });
});

describe('sync with firestore.rules', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  /** How each limit the rules enforce is written in them. */
  const IN_RULES: Partial<Record<keyof typeof LIMITS, string[]>> = {
    classNameMax: [`textUpTo(d.name, ${LIMITS.classNameMax})`],
    // The name regex: a letter, then up to 29 more characters; the key: "first last".
    nameMax: [`{0,${LIMITS.nameMax - 1}}`, `textUpTo(d.nameKey, ${2 * LIMITS.nameMax + 1})`],
    deviceMax: [`textUpTo(d.device, ${LIMITS.deviceMax})`],
    codeMaxBytes: [`d.code.toUtf8().size() <= ${LIMITS.codeMaxBytes}`, `d.code.size() <= ${LIMITS.codeMaxBytes}`],
    workspaceMaxBytes: [`d.workspace.toUtf8().size() <= ${LIMITS.workspaceMaxBytes}`, `d.workspace.size() <= ${LIMITS.workspaceMaxBytes}`],
    handinsPerDevice: [`d.handinCount <= ${LIMITS.handinsPerDevice}`],
    handinCooldownMs: [`duration.value(${LIMITS.handinCooldownMs / 1000}, 's')`],
    keepWeeksMin: [`d.keepWeeks >= ${LIMITS.keepWeeksMin}`],
    keepWeeksMax: [`d.keepWeeks <= ${LIMITS.keepWeeksMax}`],
  };
  /** Limits of the client alone: the rules do not (or cannot) check them. */
  const CLIENT_ONLY: (keyof typeof LIMITS)[] = [
    'pythonMaxBytes', // stored in `workspace`, which the rules cap at workspaceMaxBytes (docs/PYTHON.md §8.1)
    'codeDecodeCap',
    'workspaceDecodeCap',
    'clockSkewMs',
    'requestTimeoutMs',
    'batchMaxOps',
    'deletesPerRun',
    'prunePerOpen',
    'todayLimit',
    'periodPage',
    'studentPage',
    'membersWatchLimit',
    'reviewHashMax',
  ];
  it('every limit the rules enforce appears in them', () => {
    for (const [key, texts] of Object.entries(IN_RULES)) for (const text of texts) expect(rules, key).toContain(text);
    expect(rules).toContain(`request.resource.data.schema == ${CLASS_SCHEMA}`);
  });
  it('every other limit is listed as client-only; the Python limit fits in the rules’ workspace limit', () => {
    expect([...Object.keys(IN_RULES), ...CLIENT_ONLY].sort()).toEqual(Object.keys(LIMITS).sort());
    expect(CLIENT_ONLY.filter((key) => key in IN_RULES)).toEqual([]);
    expect(LIMITS.pythonMaxBytes).toBeLessThanOrEqual(LIMITS.workspaceMaxBytes);
  });
  it('Python hand-ins: the clauses of docs/PYTHON.md §8.2, and every kind the rules accept is read as itself', () => {
    expect(rules).toContain("&& (d.kind == 'code' ? d.workspace.size() == 0 : d.workspace.size() > 0);");
    expect(rules).toContain("&& d.kind in ['code', 'blocks', 'python']");
    const kinds = /d\.kind in \[([^\]]*)\]/.exec(rules)![1].split(',').map((k) => k.trim().replace(/'/g, ''));
    for (const kind of kinds) expect(readHandinDoc('H1', 'BKT4M9', { kind }).kind).toBe(kind);
  });
  it('the code alphabet and the name pattern are the same', () => {
    expect(rules).toContain(`[${CLASS_CODE_ALPHABET}]{6}`);
    // The rules escape the backslashes inside their string literal.
    expect(rules).toContain(NAME_PATTERN.source.replace(/\\/g, '\\\\'));
  });
});
