/**
 * End to end through the two APIs (docs/CLASSROOM.md §0.6, Appendix B), two named apps in one
 * process: the teacher creates a class; the student (Lite, anonymous) enters the code and a name
 * and hands in gzip bytes; a retry with the same id is idempotent; the teacher's Today listener
 * receives it and inflates it with a cap; the student presses Change, gives another name and hands
 * in again under it; the teacher sees two students.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { decodeContent } from '../src/classroom/codec';
import { loadStudentFirebase, loadTeacherFirebase } from '../src/classroom/firebase';
import { newHandinId } from '../src/classroom/model';
import { createStudentApi } from '../src/classroom/student';
import { createTeacherApi, type HandinsUpdate } from '../src/classroom/teacher';
import { ALI, CHROME_LINUX, CLASS_INPUT, SARA, memoryStorage, patchDoc, readDoc, rulesEnv, signInTeacher, waitFor } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await rulesEnv();
  await env.clearFirestore();
});
afterAll(async () => env.cleanup());

describe('flow', () => {
  it('teacher creates → student code + name + gzip hand-in → idempotent retry → live Today view → Change name → hand in again', async () => {
    const teacher = createTeacherApi();
    await teacher.ready;
    const teacherUid = await signInTeacher(await loadTeacherFirebase());
    const cls = await teacher.createClass(CLASS_INPUT);

    const updates: HandinsUpdate[] = [];
    const unsub = teacher.watchTodayHandins(cls.code, (u) => updates.push(u), (e) => updates.push({ items: [], added: [`error:${e.code}`], modified: [], removed: [] }));
    await waitFor(() => updates.length > 0);

    const storage = memoryStorage();
    const clock = { offset: 0 };
    const student = createStudentApi({ storage, userAgent: CHROME_LINUX, timeoutMs: 15_000, now: () => Date.now() + clock.offset });
    const found = await student.findClass(cls.code);
    expect(found.existing).toBeNull();
    const session = await student.join(found, ALI);
    expect((await loadStudentFirebase()).app.name).toBe('z1-student');
    expect((await loadTeacherFirebase()).app.name).toBe('z1-teacher');

    const sketch = `// blink\n${'void loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n'.repeat(30)}`;
    const id = newHandinId();
    const record = await student.handIn(session, { kind: 'code', code: sketch, workspaceJson: '', python: '' }, id);
    expect(record.content.enc).toBe('gzip');

    // "Timed out but went through": the same id again is refused by the rules, and the member doc proves it arrived.
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { lastHandinAt: (await import('firebase/firestore')).Timestamp.fromMillis(Date.now() - 20_000) });
    clock.offset = 20_000; // past the local cooldown as well
    const retry = await student.handIn(session, { kind: 'code', code: sketch, workspaceJson: '', python: '' }, id);
    expect(retry.id).toBe(id);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });

    await waitFor(() => updates.some((u) => u.added.includes(id)), 10_000, 'Today listener');
    const live = updates.at(-1)!.items.find((h) => h.id === id)!;
    expect(live).toMatchObject({ ...ALI, nameKey: 'ali khoury', uid: session.uid, kind: 'code' });
    expect(live.content.enc).toBe('gzip');
    expect(await decodeContent(live.content)).toEqual({ ok: true, code: sketch, workspaceJson: '' });
    const bomb = new Uint8Array(gzipSync(Buffer.from('x'.repeat(5_000_000))));
    expect(bomb.length).toBeLessThan(50_000);
    expect(await decodeContent({ enc: 'gzip', code: bomb, workspace: new Uint8Array(0) })).toEqual({ ok: false, problem: 'too_large' });

    // Change: the next student at this computer types another name; the same uid, renamed in place.
    student.forget();
    const again = await student.findClass(cls.code);
    expect(again.existing).toEqual(ALI);
    const session2 = await student.join(again, SARA);
    expect(session2.uid).toBe(session.uid);
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { lastHandinAt: (await import('firebase/firestore')).Timestamp.fromMillis(Date.now() - 20_000) });
    clock.offset = 40_000;
    const id2 = newHandinId();
    await student.handIn(session2, { kind: 'code', code: sketch, workspaceJson: '', python: '' }, id2);
    await waitFor(() => updates.some((u) => u.added.includes(id2)), 10_000, 'second hand-in');
    const names = new Set(updates.at(-1)!.items.map((h) => h.nameKey));
    expect(names).toEqual(new Set(['ali khoury', 'sara mansour']));
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ ...SARA, handinCount: 2 });
    unsub();
    expect(teacherUid).toBe(cls.ownerUid);
  });
});
