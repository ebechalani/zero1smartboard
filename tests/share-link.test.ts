/**
 * src/share-link.ts (docs/CLASSROOM.md §4.9, §7.2): #code= / #blocks= share links (moved from
 * editor.ts / blocks-panel.ts), #python= share links (docs/PYTHON.md §8.4), #class= join links,
 * the review payload and the history hash.
 */
import { describe, expect, it } from 'vitest';
import {
  REVIEW_HANDOFF_PREFIX,
  blocksFromHash,
  classFromHash,
  codeFromHash,
  decodeReviewPayload,
  decodeShareCode,
  encodeReviewPayload,
  encodeShareBlocks,
  encodeShareCode,
  encodeSharePython,
  handinHash,
  parseWorkspaceJson,
  pythonFromHash,
  reviewLink,
  type ReviewPayload,
} from '../src/share-link';
import { LIMITS } from '../src/classroom/model';

const WORKSPACE = { blocks: { languageVersion: 0, blocks: [{ type: 'z1_setup', id: 'a', x: 10, y: 10 }] } };

describe('share link encoding', () => {
  it('round-trips arbitrary text as base64url', () => {
    const samples = ['', 'void setup() {}', 'héllo wörld 🙂', '\n\t"quotes" & <tags>', 'a'.repeat(1000)];
    for (const s of samples) {
      const encoded = encodeShareCode(s);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeShareCode(encoded)).toBe(s);
    }
  });
  it('extracts code from a hash and rejects junk', () => {
    const code = 'int x = 1;\nvoid loop() {}';
    expect(codeFromHash(`#code=${encodeShareCode(code)}`)).toBe(code);
    expect(codeFromHash('#code=!!!not base64')).toBeNull();
    expect(codeFromHash('#other')).toBeNull();
    expect(codeFromHash('')).toBeNull();
    expect(decodeShareCode('%%%')).toBeNull();
    expect(decodeShareCode('gA')).toBeNull(); // invalid UTF-8
  });
  it('parses workspace JSON objects only', () => {
    expect(parseWorkspaceJson('{"blocks": {}}')).toEqual({ blocks: {} });
    expect(parseWorkspaceJson('42')).toBeNull();
    expect(parseWorkspaceJson('null')).toBeNull();
    expect(parseWorkspaceJson('"text"')).toBeNull();
    expect(parseWorkspaceJson('[1]')).toBeNull();
    expect(parseWorkspaceJson('')).toBeNull();
  });
  it('round-trips a workspace through #blocks= and rejects junk', () => {
    const encoded = encodeShareBlocks(WORKSPACE);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(blocksFromHash(`#blocks=${encoded}`)).toEqual(WORKSPACE);
    expect(blocksFromHash('')).toBeNull();
    expect(blocksFromHash('#code=aGk')).toBeNull();
    expect(blocksFromHash('#blocks=!!!not base64')).toBeNull();
    expect(blocksFromHash(`#blocks=${encodeShareCode('not json')}`)).toBeNull();
    expect(blocksFromHash(`#blocks=${encodeShareCode('[1]')}`)).toBeNull();
  });
});

describe('python share links', () => {
  it('round-trip a Python program through #python= (Unicode too) with the #code= encoding', () => {
    const samples = ['print("ON")\n', 'température = 25  # °C\nprint(f"{température} °C 🙂")\n', 'while True:\n\tpass\r\n', 'x'.repeat(5000)];
    for (const s of samples) {
      const encoded = encodeSharePython(s);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(encoded).toBe(encodeShareCode(s));
      expect(pythonFromHash(`#python=${encoded}`)).toBe(s);
    }
  });
  it('carry the largest program a hand-in accepts (50,000 bytes, accents too)', () => {
    const program = `print("é")\n${'# ligne commentée ………\n'.repeat(2000)}`.slice(0, 20_000);
    const big = program + 'x'.repeat(LIMITS.pythonMaxBytes - new TextEncoder().encode(program).length);
    expect(new TextEncoder().encode(big).length).toBe(LIMITS.pythonMaxBytes);
    expect(pythonFromHash(`#python=${encodeSharePython(big)}`)).toBe(big);
  });
  it('reject junk and the other link kinds', () => {
    const encoded = encodeSharePython('x = 1\n');
    expect(pythonFromHash('')).toBeNull();
    expect(pythonFromHash('#python=')).toBeNull();
    expect(pythonFromHash('#python=!!!not base64')).toBeNull();
    expect(pythonFromHash('#python=gA')).toBeNull(); // invalid UTF-8
    expect(pythonFromHash(`#code=${encoded}`)).toBeNull();
    expect(pythonFromHash(`#python=${encoded}&x=1`)).toBeNull();
    expect(codeFromHash(`#python=${encoded}`)).toBeNull();
    expect(blocksFromHash(`#python=${encodeSharePython('{}')}`)).toBeNull();
  });
});

describe('classFromHash', () => {
  it('normalises the code', () => {
    expect(classFromHash('#class=BKT4M9')).toBe('BKT4M9');
    expect(classFromHash('#class=bkt-4m9')).toBe('BKT4M9');
    expect(classFromHash('#class=8KT4M9')).toBe('BKT4M9');
    expect(classFromHash('#class=BKT%2D4M9')).toBe('BKT4M9');
  });
  it('rejects anything else', () => {
    expect(classFromHash('#class=')).toBeNull();
    expect(classFromHash('#class=BAT4M9')).toBeNull();
    expect(classFromHash('#code=BKT4M9')).toBeNull();
    expect(classFromHash('#class=%E0%A4%A')).toBeNull();
    expect(classFromHash('')).toBeNull();
  });
});

describe('review payload', () => {
  const payload: ReviewPayload = {
    v: 1,
    kind: 'blocks',
    code: 'void setup() {}\n',
    workspaceJson: JSON.stringify(WORKSPACE),
    python: '',
    who: 'ali.k',
    className: '8B Robotics',
    task: 'Traffic light',
    title: 'Mine',
    at: 1_700_000_000_000,
  };
  it('round-trips and drops extra keys', () => {
    const encoded = encodeReviewPayload({ ...payload, extra: 'no' } as ReviewPayload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeReviewPayload(encoded)).toEqual(payload);
    expect(decodeReviewPayload(encodeShareCode(JSON.stringify({ ...payload, evil: '<img>' })))).toEqual(payload);
  });
  it('carries a Python hand-in, and reads payloads without python (older links) as python ""', () => {
    const python: ReviewPayload = { ...payload, kind: 'python', workspaceJson: '', python: 'print("Lumière")\n' };
    expect(decodeReviewPayload(encodeReviewPayload(python))).toEqual(python);
    const { python: _dropped, ...older } = payload;
    expect(decodeReviewPayload(encodeShareCode(JSON.stringify(older)))).toEqual({ ...payload, python: '' });
    expect(decodeReviewPayload(encodeReviewPayload(older))).toEqual({ ...payload, python: '' });
  });
  it('checks the shape strictly', () => {
    const bad = [
      { ...payload, v: 2 },
      { ...payload, kind: 'pyth0n' },
      { ...payload, python: 7 },
      { ...payload, code: 7 },
      { ...payload, at: 'now' },
      { ...payload, at: Infinity },
      { ...payload, who: undefined },
      [payload],
      null,
      'text',
    ];
    for (const b of bad) expect(decodeReviewPayload(encodeShareCode(JSON.stringify(b))), JSON.stringify(b)).toBeNull();
    expect(decodeReviewPayload('!!!')).toBeNull();
    expect(decodeReviewPayload(encodeShareCode('{not json'))).toBeNull();
  });
  it('links with #review= under the limit and #rid= plus a handoff over it', () => {
    const small = reviewLink(payload);
    expect(small.handoff).toBeNull();
    expect(small.href).toBe(`./review.html#review=${encodeReviewPayload(payload)}`);
    expect(decodeReviewPayload(small.href.slice(small.href.indexOf('=') + 1))).toEqual(payload);
    expect(reviewLink(payload, 'https://x.github.io/zero1smartboard/teacher.html').href).toBe(`https://x.github.io/zero1smartboard/review.html#review=${encodeReviewPayload(payload)}`);

    const large = reviewLink({ ...payload, code: 'x'.repeat(LIMITS.reviewHashMax) });
    expect(large.href).toMatch(/^\.\/review\.html#rid=[A-Za-z0-9]{16}$/);
    expect(large.handoff).not.toBeNull();
    const rid = large.href.slice(large.href.indexOf('=') + 1);
    expect(large.handoff!.key).toBe(`${REVIEW_HANDOFF_PREFIX}${rid}`);
    expect(decodeReviewPayload(large.handoff!.value)?.code).toBe('x'.repeat(LIMITS.reviewHashMax));
    expect(reviewLink({ ...payload, code: 'y'.repeat(LIMITS.reviewHashMax) }).href).not.toBe(large.href);
  });
  it('counts the Python program in the size of the link: a large one goes through the #rid= handoff intact', () => {
    const base: ReviewPayload = { ...payload, kind: 'python', workspaceJson: '' };
    const small = reviewLink({ ...base, python: 'print("hi")\n' });
    expect(small.handoff).toBeNull();
    expect(decodeReviewPayload(small.href.slice(small.href.indexOf('=') + 1))?.python).toBe('print("hi")\n');
    const program = 'print("Température")\n'.repeat(Math.ceil(LIMITS.pythonMaxBytes / 22));
    const large = reviewLink({ ...base, python: program });
    expect(large.href).toMatch(/^\.\/review\.html#rid=[A-Za-z0-9]{16}$/);
    expect(decodeReviewPayload(large.handoff!.value)).toEqual({ ...base, python: program });
  });
});

describe('handinHash', () => {
  it('makes #code= for sketches and #blocks= for blocks, falling back to the code', () => {
    const code = 'void loop() {}';
    expect(handinHash({ kind: 'code', code, workspaceJson: '' })).toEqual({ hash: `#code=${encodeShareCode(code)}`, fellBack: false });
    expect(handinHash({ kind: 'blocks', code, workspaceJson: JSON.stringify(WORKSPACE) })).toEqual({ hash: `#blocks=${encodeShareBlocks(WORKSPACE)}`, fellBack: false });
    expect(handinHash({ kind: 'blocks', code, workspaceJson: '[1]' })).toEqual({ hash: `#code=${encodeShareCode(code)}`, fellBack: true });
    expect(handinHash({ kind: 'blocks', code, workspaceJson: '' })).toEqual({ hash: `#code=${encodeShareCode(code)}`, fellBack: true });
  });
  it('makes #python= for a Python hand-in (docs/PYTHON.md §8.4), falling back to the sketch without a program', () => {
    const code = 'void loop() {}';
    const python = 'print("Lumière")\n';
    const hash = handinHash({ kind: 'python', code, workspaceJson: '', python });
    expect(hash).toEqual({ hash: `#python=${encodeSharePython(python)}`, fellBack: false });
    expect(pythonFromHash(hash.hash)).toBe(python);
    expect(handinHash({ kind: 'python', code, workspaceJson: '', python: '' })).toEqual({ hash: `#code=${encodeShareCode(code)}`, fellBack: true });
    expect(handinHash({ kind: 'python', code, workspaceJson: '' })).toEqual({ hash: `#code=${encodeShareCode(code)}`, fellBack: true });
  });
});
