/**
 * What every dashboard view gets (docs/CLASSROOM.md §1.3, §4.13): the API, the clock, the
 * storages, the side effects a test replaces (download, clipboard, confirm), the error banner,
 * the toast and the "Saving…" status of writes.
 */
import { ClassroomError, toClassroomError } from '../classroom/errors';
import type { TeacherApi } from '../classroom/teacher';

export const WAITING_TEXT = 'Waiting for the connection… the change is saved when you are back online.';
export const SAVING_TEXT = 'Saving…';
/** After this long a pending write shows WAITING_TEXT. */
export const WAITING_AFTER_MS = 10_000;
/** What `save` resolves with when the write failed (the banner has the error). */
export const SAVE_FAILED: unique symbol = Symbol('save failed');
export type SaveResult<T> = T | typeof SAVE_FAILED;

export interface DashboardContext {
  readonly api: TeacherApi;
  now(): Date;
  readonly storage: Storage | null;
  readonly tabStorage: Storage | null;
  download(name: string, data: string | Blob): void;
  copyText(text: string): Promise<void>;
  confirm(text: string): boolean;
  toast(text: string): void;
  /** Show the teacher text of `err` in the banner; `retry` adds a Retry button. */
  showError(err: unknown, retry?: () => void): void;
  clearError(): void;
  online(): boolean;
  /** Store a review-page handoff (z1.review.<rid>) now, so a middle-click on the link works; cleared on sign-out and pagehide. */
  rememberHandoff(key: string, value: string): void;
  /**
   * Run a write: `status` reads "Saving…" until it settles (WAITING_TEXT after 10 s); a failure
   * goes to the banner and the result is SAVE_FAILED.
   */
  save<T>(promise: Promise<T>, status?: HTMLElement | null): Promise<SaveResult<T>>;
  /** A timer that is cleared when the dashboard is destroyed. */
  setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(id: ReturnType<typeof setInterval>): void;
}

export function asClassroomError(err: unknown): ClassroomError {
  return err instanceof ClassroomError ? err : toClassroomError(err, 'teacher');
}

/** Wire the "Saving…" status of a write to `status`; resolves with the value, or SAVE_FAILED. */
export function trackSave<T>(ctx: DashboardContext, promise: Promise<T>, status: HTMLElement | null | undefined): Promise<SaveResult<T>> {
  if (status) status.textContent = SAVING_TEXT;
  const timer = ctx.setTimeout(() => {
    if (status && status.textContent === SAVING_TEXT) status.textContent = WAITING_TEXT;
  }, WAITING_AFTER_MS);
  return promise.then(
    (value) => {
      ctx.clearTimeout(timer);
      if (status) status.textContent = '';
      return value;
    },
    (err) => {
      ctx.clearTimeout(timer);
      if (status) status.textContent = '';
      ctx.showError(err);
      return SAVE_FAILED;
    },
  );
}
