/**
 * End to end through the two APIs (docs/CLASSROOM.md §0.6, Appendix B), two named apps in one
 * process: the teacher creates a class with a 15-minute window; the student joins (Lite,
 * anonymous) and hands in gzip bytes; a retry with the same id is idempotent; the teacher's Today
 * listener receives it, inflates it with a cap and re-files it; after sign-out the new uid sees
 * nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { decodeContent } from '../src/classroom/codec';
import { loadStudentFirebase, loadTeacherFirebase } from '../src/classroom/firebase';
import { newHandinId } from '../src/classroom/model';
import { createStudentApi } from '../src/classroom/student';
import { createTeacherApi, type HandinsUpdate } from '../src/classroom/teacher';
import { CHROME_LINUX, CLASS_INPUT, memoryStorage, patchDoc, readDoc, rulesEnv, signInTeacher, waitFor } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await rulesEnv();
  await env.clearFirestore();
});
afterAll(async () => env.cleanup());

describe('flow', () => {
  it('teacher window → student join + gzip hand-in → idempotent retry → live Today view → re-file → sign-out', async () => {
    const teacher = createTeacherApi();
    await teacher.ready;
    const teacherUid = await signInTeacher(await loadTeacherFirebase());
    const cls = await teacher.createClass({ ...CLASS_INPUT, joinOpen: false });
    await teacher.openJoinWindow(cls.code);

    const updates: HandinsUpdate[] = [];
    const unsub = teacher.watchTodayHandins(cls.code, (u) => updates.push(u), (e) => updates.push({ items: [], added: [`error:${e.code}`], modified: [], removed: [] }));
    await waitFor(() => updates.length > 0);

    const storage = memoryStorage();
    const clock = { offset: 0 };
    const student = createStudentApi({ storage, tabStorage: memoryStorage(), userAgent: CHROME_LINUX, timeoutMs: 15_000, now: () => Date.now() + clock.offset });
    const found = await student.findClass(cls.code);
    expect(found.info.joinOpen).toBe(false);
    expect(found.info.joinWindowAt).toBeInstanceOf(Date);
    const session = await student.join(found.info, 'aaaaaaa1');
    expect((await loadStudentFirebase()).app.name).toBe('z1-student');
    expect((await loadTeacherFirebase()).app.name).toBe('z1-teacher');

    const sketch = `// blink\n${'void loop() {\n  digitalWrite(13, HIGH);\n  delay(500);\n  digitalWrite(13, LOW);\n  delay(500);\n}\n'.repeat(30)}`;
    const id = newHandinId();
    const record = await student.handIn(session, { kind: 'code', code: sketch, workspaceJson: '', taskId: cls.tasks[0].taskId, title: 'Traffic light', note: 'done' }, id);
    expect(record.content.enc).toBe('gzip');

    // "Timed out but went through": the same id again is refused by the rules, and the member doc proves it arrived.
    await patchDoc(env, `classes/${cls.code}/members/${session.uid}`, { lastHandinAt: (await import('firebase/firestore')).Timestamp.fromMillis(Date.now() - 20_000) });
    clock.offset = 20_000; // past the local cooldown as well
    const retry = await student.handIn(session, { kind: 'code', code: sketch, workspaceJson: '', taskId: cls.tasks[0].taskId, title: 'Traffic light', note: 'done' }, id);
    expect(retry.id).toBe(id);
    expect(await readDoc(env, `classes/${cls.code}/members/${session.uid}`)).toMatchObject({ handinCount: 1, lastHandinId: id });
    expect((await student.myHandins(session)).items).toHaveLength(1);

    await waitFor(() => updates.some((u) => u.added.includes(id)), 10_000, 'Today listener');
    const live = updates.at(-1)!.items.find((h) => h.id === id)!;
    expect(live).toMatchObject({ username: 'ali.k', uid: session.uid, kind: 'code', title: 'Traffic light', note: 'done' });
    expect(live.content.enc).toBe('gzip');
    expect(await decodeContent(live.content)).toEqual({ ok: true, code: sketch, workspaceJson: '' });
    const bomb = new Uint8Array(gzipSync(Buffer.from('x'.repeat(5_000_000))));
    expect(bomb.length).toBeLessThan(50_000);
    expect(await decodeContent({ enc: 'gzip', code: bomb, workspace: new Uint8Array(0) })).toEqual({ ok: false, problem: 'too_large' });

    await teacher.refileHandin(cls.code, id, { studentId: 'bbbbbbb2' });
    await waitFor(() => updates.some((u) => u.modified.includes(id)), 10_000, 'modified');
    expect(updates.at(-1)!.items.find((h) => h.id === id)).toMatchObject({ username: 'sara.m', studentId: 'bbbbbbb2' });
    unsub();

    await student.leave();
    const next = createStudentApi({ storage: memoryStorage(), tabStorage: memoryStorage(), userAgent: CHROME_LINUX, timeoutMs: 15_000 });
    const again = await next.findClass(cls.code);
    expect(again.existing).toBeNull();
    const session2 = await next.join(again.info, 'aaaaaaa1');
    expect(session2.uid).not.toBe(session.uid);
    expect((await next.myHandins(session2)).items).toEqual([]);
    await expect(next.myHandins(session)).rejects.toMatchObject({ code: 'permission' });
    expect(teacherUid).toBe(cls.ownerUid);
  });
});
