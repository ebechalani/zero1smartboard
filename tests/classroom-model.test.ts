/**
 * src/classroom/model.ts (docs/CLASSROOM.md §4.4, §7.2): class codes, usernames, rosters, tasks,
 * joining, text cleaning, device labels, and the sync of LIMITS with firestore.rules.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLASS_CODE_ALPHABET,
  LIMITS,
  USERNAME_PATTERN,
  classLink,
  cleanLine,
  cleanMultiline,
  codeProblem,
  deviceLabel,
  draftProblem,
  formatClassCode,
  generateClassCode,
  joinStatus,
  nearDuplicates,
  newHandinId,
  newStudentId,
  newTaskId,
  normalizeClassCode,
  normalizeUsername,
  planRosterAdd,
  planTasksAdd,
  readClassDoc,
  readHandinDoc,
  readMemberDoc,
  shortDeviceId,
  sortedRoster,
  sortedTasks,
  usernameProblem,
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
  it('studentId: 8 × [a-z0-9], never an existing key', () => {
    expect(newStudentId({})).toMatch(/^[a-z0-9]{8}$/);
    let call = 0;
    const source = (n: number) => Uint8Array.from({ length: n }, () => (call++ < 8 ? 0 : 1));
    expect(newStudentId({ aaaaaaaa: 'taken' }, source)).toBe('bbbbbbbb');
  });
  it('taskId: 6 × [a-z0-9], never an existing key', () => {
    expect(newTaskId({})).toMatch(/^[a-z0-9]{6}$/);
    let call = 0;
    const source = (n: number) => Uint8Array.from({ length: n }, () => (call++ < 6 ? 0 : 2));
    expect(newTaskId({ aaaaaa: 'taken' }, source)).toBe('cccccc');
  });
  it('handinId: 20 × [A-Za-z0-9]; bytes ≥ 248 are rejected', () => {
    expect(newHandinId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(new Set(Array.from({ length: 50 }, () => newHandinId())).size).toBe(50);
    expect(newHandinId(scripted([255, 248, ...Array(20).fill(0)]))).toBe('A'.repeat(20));
  });
});

describe('usernames', () => {
  it.each([
    ['Ali Khalil', 'ali.khalil', 'ali.k'],
    ['Élise Martin', 'elise.martin', 'elise.m'],
    ['Ali Ben Salah', 'ali.ben.salah', 'ali.s'],
    ['  sara__m ', 'sara_m', 'sara_m'],
    ["O'Neil", 'oneil', 'oneil'],
    ['محمد', '', ''],
    ['Jean-Luc  Picard', 'jean-luc.picard', 'jean-luc.p'],
    ['.ali.', 'ali', 'ali'],
    ['ali._-k', 'ali.k', 'ali.k'],
    ['x'.repeat(30), 'x'.repeat(24), 'x'.repeat(24)],
    ['Ali (Khalil)', 'ali.khalil', 'ali'],
  ])('normalizes %j → %j / %j (shortened)', (input, plain, short) => {
    expect(normalizeUsername(input)).toBe(plain);
    expect(normalizeUsername(input, { shortenLastName: true })).toBe(short);
  });
  it('finds the problem of a username', () => {
    expect(usernameProblem('')).toBe('empty');
    expect(usernameProblem('a')).toBe('too_short');
    expect(usernameProblem('x'.repeat(25))).toBe('too_long');
    expect(usernameProblem('Ali.K')).toBe('invalid');
    expect(usernameProblem('.ali')).toBe('invalid');
    expect(usernameProblem('ali k')).toBe('invalid');
    expect(usernameProblem('ali.k')).toBeNull();
    expect(usernameProblem('x'.repeat(24))).toBeNull();
    expect(USERNAME_PATTERN.test('7ali_k-2')).toBe(true);
  });
  it('lists names that differ by one character', () => {
    expect(nearDuplicates(['ali.k', 'ali.m', 'sara.m', 'ali.kh'])).toEqual([
      ['ali.k', 'ali.m'],
      ['ali.k', 'ali.kh'],
    ]);
    expect(nearDuplicates(['ali.k', 'ali.k'])).toEqual([]);
    expect(nearDuplicates(['ab', 'ba'])).toEqual([]);
  });
});

describe('roster and task plans', () => {
  it('splits on newlines, commas and semicolons, shortens, and reports duplicates', () => {
    const plan = planRosterAdd({}, 'Ali Khalil\nSara Mansour, Omar Haddad; Ali Karam\n\nali.k\n', { shortenLastName: true });
    expect(plan.add.map((e) => e.username)).toEqual(['ali.k', 'sara.m', 'omar.h']);
    for (const e of plan.add) expect(e.studentId).toMatch(/^[a-z0-9]{8}$/);
    expect(new Set(plan.add.map((e) => e.studentId)).size).toBe(3);
    expect(plan.problems).toEqual([
      { line: 4, input: 'Ali Karam', normalized: 'ali.k', reason: 'duplicate' },
      { line: 6, input: 'ali.k', normalized: 'ali.k', reason: 'duplicate' },
    ]);
    expect(plan.warnings).toEqual([]);
  });
  it('reports names already in the class, invalid names and the 100 limit', () => {
    const plan = planRosterAdd({ s0000001: 'nour.h' }, 'Nour Haddad\nمحمد\na', { shortenLastName: true });
    expect(plan.add).toEqual([]);
    expect(plan.problems.map((p) => p.reason)).toEqual(['already_in_class', 'empty', 'too_short']);
    const big: Record<string, string> = {};
    for (let i = 0; i < 99; i++) big[`s${String(i).padStart(7, '0')}`] = `student.${i}`;
    const full = planRosterAdd(big, 'one.more\ntwo.more');
    expect(full.add.map((e) => e.username)).toEqual(['one.more']);
    expect(full.problems).toEqual([{ line: 2, input: 'two.more', normalized: 'two.more', reason: 'too_many' }]);
  });
  it('warns about near duplicates involving a new name (not between two existing ones)', () => {
    const plan = planRosterAdd({ a: 'ali.k', b: 'ali.m' }, 'ali.h\nsara.m');
    expect(plan.warnings).toEqual([
      { names: ['ali.k', 'ali.h'], reason: 'near_duplicate' },
      { names: ['ali.m', 'ali.h'], reason: 'near_duplicate' },
    ]);
  });
  it('plans tasks: cleaned titles, too long, duplicates, at most 30', () => {
    const plan = planTasksAdd({ tsk001: 'Traffic light' }, `  Servo   sweep \n\nTraffic light\n${'x'.repeat(61)}\nBlink`);
    expect(plan.add.map((t) => t.title)).toEqual(['Servo sweep', 'Blink']);
    for (const t of plan.add) expect(t.taskId).toMatch(/^[a-z0-9]{6}$/);
    expect(plan.problems).toEqual([
      { line: 3, reason: 'duplicate' },
      { line: 4, reason: 'too_long' },
    ]);
    const many: Record<string, string> = {};
    for (let i = 0; i < 29; i++) many[`t${String(i).padStart(5, '0')}`] = `Task ${i}`;
    expect(planTasksAdd(many, 'A\nB').problems).toEqual([{ line: 2, reason: 'too_many' }]);
  });
  it('sorts rosters and tasks with String() values', () => {
    expect(sortedRoster({ b: 'zed', a: 'amy', c: 12 as unknown as string })).toEqual([
      { studentId: 'c', username: '12' },
      { studentId: 'a', username: 'amy' },
      { studentId: 'b', username: 'zed' },
    ]);
    expect(sortedTasks({ t2: 'Servo', t1: 'Blink' })).toEqual([
      { taskId: 't1', title: 'Blink' },
      { taskId: 't2', title: 'Servo' },
    ]);
  });
});

describe('joinStatus', () => {
  const now = Date.UTC(2026, 8, 27, 10, 0, 0);
  const minutesAgo = (m: number) => new Date(now - m * 60_000);
  it('always open', () => {
    expect(joinStatus({ joinOpen: true, joinWindowAt: null, rejoin: {} }, 's1', now)).toEqual({ open: true, until: null });
  });
  it('class window: inside, within the skew, expired', () => {
    const inside = joinStatus({ joinOpen: false, joinWindowAt: minutesAgo(5), rejoin: {} }, null, now);
    expect(inside.open).toBe(true);
    expect(inside.until?.getTime()).toBe(now + 10 * 60_000);
    expect(joinStatus({ joinOpen: false, joinWindowAt: minutesAgo(15.5), rejoin: {} }, null, now).open).toBe(true);
    expect(joinStatus({ joinOpen: false, joinWindowAt: minutesAgo(16), rejoin: {} }, null, now).open).toBe(false);
    expect(joinStatus({ joinOpen: false, joinWindowAt: null, rejoin: {} }, 's1', now).open).toBe(false);
  });
  it('rejoin: this student only', () => {
    const cls = { joinOpen: false, joinWindowAt: null, rejoin: { s1: minutesAgo(3) } };
    expect(joinStatus(cls, 's1', now)).toEqual({ open: true, until: new Date(now + 12 * 60_000) });
    expect(joinStatus(cls, 's2', now).open).toBe(false);
    expect(joinStatus(cls, null, now).open).toBe(false);
    expect(joinStatus({ ...cls, rejoin: { s1: minutesAgo(20) } }, 's1', now).open).toBe(false);
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
  it('cleanMultiline: keeps line breaks, at most one empty line, cut', () => {
    expect(cleanMultiline(' Hello Miss,\r\n\r\n\r\n\r\nHere it is.​\u0007 ', 500)).toBe('Hello Miss,\n\nHere it is.');
    expect(cleanMultiline('a b\tc', 500)).toBe('a b c');
    expect(cleanMultiline('x'.repeat(600), 500)).toHaveLength(500);
    expect(cleanMultiline(`${' '.repeat(100000)}b \t\n c `, 500)).toBe('b\n c');
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
  const draft = { kind: 'code' as const, code: 'void setup() {}', workspaceJson: '', taskId: '', title: '', note: '' };
  it('finds empty and oversize drafts', () => {
    expect(draftProblem(draft)).toBeNull();
    expect(draftProblem({ ...draft, code: '  \n' })).toBe('empty_sketch');
    expect(draftProblem({ ...draft, code: 'x'.repeat(50_001) })).toBe('too_large');
    expect(draftProblem({ ...draft, code: 'é'.repeat(25_001) })).toBe('too_large');
    expect(draftProblem({ ...draft, code: 'x'.repeat(50_000) })).toBeNull();
    expect(draftProblem({ ...draft, kind: 'blocks', workspaceJson: 'x'.repeat(100_001) })).toBe('too_large');
  });
});

describe('document readers', () => {
  const ts = (ms: number) => ({ toDate: () => new Date(ms) });
  it('reads a class doc with tolerant types', () => {
    const cls = readClassDoc({
      ownerUid: 'tA',
      name: '8B',
      teacherName: 'Mr. B',
      roster: { aaaaaaa1: 'ali.k', bbbbbbb2: 12 },
      joinOpen: 'yes',
      joinWindowAt: ts(1000),
      rejoin: { aaaaaaa1: ts(2000), junk: 'x' },
      handinsOpen: true,
      tasks: { tsk001: 'Traffic light' },
      currentTaskId: 'tsk001',
      keepWeeks: 10,
      deleting: false,
      createdAt: ts(3000),
      updatedAt: null,
    });
    expect(cls.roster).toEqual({ aaaaaaa1: 'ali.k', bbbbbbb2: '12' });
    expect(cls.joinOpen).toBe(false);
    expect(cls.joinWindowAt?.getTime()).toBe(1000);
    expect(cls.rejoin).toEqual({ aaaaaaa1: new Date(2000) });
    expect(cls.createdAt?.getTime()).toBe(3000);
    expect(cls.updatedAt).toBeNull();
    expect(readClassDoc({}).keepWeeks).toBe(LIMITS.keepWeeksMin);
  });
  it('reads member and hand-in docs, with Bytes as Uint8Array', () => {
    expect(readMemberDoc({ studentId: 's', username: 'u', device: 'd', joinedAt: ts(5), handinCount: 2, lastHandinAt: null, lastHandinId: '' })).toEqual({
      studentId: 's',
      username: 'u',
      device: 'd',
      joinedAt: new Date(5),
      handinCount: 2,
      lastHandinAt: null,
      lastHandinId: '',
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const record = readHandinDoc('H1', 'BKT4M9', {
      uid: 'u',
      studentId: 's',
      username: 'ali.k',
      kind: 'blocks',
      taskId: '',
      title: 't',
      note: 'n',
      createdAt: ts(7),
      enc: 'gzip',
      code: { toUint8Array: () => bytes },
      workspace: { toUint8Array: () => new Uint8Array(0) },
    });
    expect(record.content).toEqual({ enc: 'gzip', code: bytes, workspace: new Uint8Array(0) });
    expect(record.createdAt?.getTime()).toBe(7);
    expect(record.kind).toBe('blocks');
    expect(readHandinDoc('H2', 'BKT4M9', { enc: 'plain', code: 'x', workspace: '' }).content).toEqual({ enc: 'plain', code: 'x', workspace: '' });
  });
});

describe('sync with firestore.rules', () => {
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  it('every limit the rules enforce appears in them', () => {
    const numbers = [
      LIMITS.classNameMax,
      LIMITS.rosterMax,
      LIMITS.tasksMax,
      LIMITS.usernameMax - 1, // {1,23} after the first character
      LIMITS.titleMax,
      LIMITS.noteMax,
      LIMITS.deviceMax,
      LIMITS.codeMaxBytes,
      LIMITS.workspaceMaxBytes,
      LIMITS.handinsPerDevice,
      LIMITS.keepWeeksMax,
    ];
    for (const n of numbers) expect(rules, String(n)).toMatch(new RegExp(`\\b${n}\\b`));
    expect(rules).toContain(`duration.value(${LIMITS.handinCooldownMs / 1000}, 's')`);
    expect(rules).toContain(`duration.value(${LIMITS.joinWindowMs / 60_000}, 'm')`);
  });
  it('the code alphabet and the username pattern are the same', () => {
    expect(rules).toContain(`[${CLASS_CODE_ALPHABET}]{6}`);
    expect(rules).toContain(USERNAME_PATTERN.source.replace(/^\^|\$$/g, ''));
  });
});
