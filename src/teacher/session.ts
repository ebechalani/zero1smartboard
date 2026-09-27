/**
 * The live state of one open class (docs/CLASSROOM.md §4.13 "Live data"): the class listener,
 * the Today listener (or the one-off view of a longer period), the members listener while a
 * view needs it, the decode cache and the review links. A session outlives its page: when the
 * teacher switches class, the previous session is parked for 10 minutes so coming back re-bills
 * nothing.
 */
import { ClassroomError } from '../classroom/errors';
import type { HandinRecord } from '../classroom/model';
import type { ClassDetail, HandinsUpdate, Member, Unsubscribe } from '../classroom/teacher';
import type { DashboardContext } from './context';
import { periodKey, readItem, readJson, seenKey, writeItem } from './format';
import { DecodeCache, newestFirst, reviewLinkFor } from './handins';

export type Period = 'today' | '7' | '14' | '30';
export const PERIODS: { value: Period; label: string; header: string }[] = [
  { value: 'today', label: 'Today', header: 'today' },
  { value: '7', label: 'Last 7 days', header: 'in the last 7 days' },
  { value: '14', label: 'Last 14 days', header: 'in the last 14 days' },
  { value: '30', label: 'Last 30 days', header: 'in the last 30 days' },
];
export const PARK_MS = 10 * 60_000;

export interface SessionError {
  kind: 'class' | 'today' | 'members' | 'period';
  error: ClassroomError;
}

export class ClassSession {
  /** undefined while loading; null when the class is gone. */
  detail: ClassDetail | null | undefined = undefined;
  period: Period;
  /** The hand-ins of the current period view, newest first. */
  items: HandinRecord[] = [];
  /** Ids added by the last live update (for the "n new hand-ins" announcement). */
  lastAdded: string[] = [];
  loading = false;
  hasMore = false;
  members: Member[] | null = null;
  readonly cache = new DecodeCache();
  error: SessionError | null = null;
  /** nameKey → createdAt ms of the newest hand-in the teacher looked at (z1.teacher.seen.<code>). */
  seen: Record<string, number>;
  /** Review links by hand-in id and class name: one #rid= handoff per record, reused across renders. */
  private readonly links = new Map<string, ReturnType<typeof reviewLinkFor>>();

  private classUnsub: Unsubscribe | null = null;
  private todayUnsub: Unsubscribe | null = null;
  private membersUnsub: Unsubscribe | null = null;
  private membersUsers = 0;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private stopped = false;

  constructor(
    readonly ctx: DashboardContext,
    readonly code: string,
  ) {
    const saved = readItem(ctx.storage, periodKey(code));
    this.period = saved === '7' || saved === '14' || saved === '30' ? saved : 'today';
    const seen = readJson<unknown>(ctx.storage, seenKey(code), {});
    this.seen = {};
    if (seen && typeof seen === 'object') {
      for (const [k, v] of Object.entries(seen as Record<string, unknown>)) if (typeof v === 'number') this.seen[k] = v;
    }
  }

  /** The teacher looked at this student's hand-in made at `at`: newer ones stay "New". */
  markSeen(nameKey: string, at: Date | null): void {
    const ms = at ? at.getTime() : this.ctx.now().getTime();
    if ((this.seen[nameKey] ?? 0) >= ms) return;
    this.seen[nameKey] = ms;
    writeItem(this.ctx.storage, seenKey(this.code), JSON.stringify(this.seen));
    this.notify();
  }

  /**
   * The review link of a decoded record, memoised per record and class name: a large payload
   * gets ONE `z1.review.<rid>` handoff, stored once, instead of a fresh 60 KB entry per render.
   */
  reviewLink(record: HandinRecord, decoded: { code: string; workspaceJson: string }): ReturnType<typeof reviewLinkFor> {
    const className = this.detail?.name ?? '';
    const key = `${record.id}|${className}`;
    let link = this.links.get(key);
    if (!link) {
      link = reviewLinkFor(record, decoded, className);
      this.links.set(key, link);
      if (link.handoff) this.ctx.rememberHandoff(link.handoff.key, link.handoff.value);
    }
    return link;
  }

  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Subscribe to the class and its hand-ins (idempotent). */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.classUnsub = this.ctx.api.watchClass(
      this.code,
      (detail) => {
        this.detail = detail;
        if (this.error?.kind === 'class') this.error = null;
        this.notify();
      },
      (error) => {
        this.error = { kind: 'class', error };
        this.notify();
      },
    );
    this.subscribeView();
  }

  /** Unsubscribe everything. */
  stop(): void {
    this.stopped = true;
    this.classUnsub?.();
    this.classUnsub = null;
    this.todayUnsub?.();
    this.todayUnsub = null;
    this.membersUnsub?.();
    this.membersUnsub = null;
    this.membersUsers = 0;
  }

  /** The class listener alone (the page is gone for good, e.g. the class was deleted). */
  get active(): boolean {
    return this.started && !this.stopped;
  }

  /** Re-subscribe the listener that failed (the banner's Retry). */
  retry(): void {
    const kind = this.error?.kind;
    this.error = null;
    if (kind === 'class') {
      this.classUnsub?.();
      this.started = false;
      this.start();
    } else if (kind === 'members') {
      this.membersUnsub?.();
      this.membersUnsub = null;
      if (this.membersUsers > 0) this.subscribeMembers();
    } else {
      this.subscribeView();
    }
    this.notify();
  }

  setPeriod(period: Period): void {
    if (period === this.period) return;
    this.period = period;
    writeItem(this.ctx.storage, periodKey(this.code), period);
    this.subscribeView();
    this.notify();
  }

  /** Reload the one-off view (the Refresh button). */
  refresh(): void {
    if (this.period !== 'today') this.subscribeView();
  }

  private subscribeView(): void {
    this.todayUnsub?.();
    this.todayUnsub = null;
    this.items = [];
    this.lastAdded = [];
    this.hasMore = false;
    if (this.period === 'today') {
      this.loading = true;
      this.todayUnsub = this.ctx.api.watchTodayHandins(
        this.code,
        (u) => this.applyUpdate(u),
        (error) => {
          this.loading = false;
          this.error = { kind: 'today', error };
          this.notify();
        },
      );
    } else {
      void this.loadPeriod();
    }
  }

  private applyUpdate(u: HandinsUpdate): void {
    const first = this.loading;
    this.loading = false;
    this.items = [...u.items].sort(newestFirst);
    this.lastAdded = first ? [] : u.added;
    if (this.error?.kind === 'today') this.error = null;
    void this.decode(this.items);
    this.notify();
  }

  private async loadPeriod(): Promise<void> {
    const days = Number(this.period);
    const since = new Date(this.ctx.now().getTime() - days * 86_400_000);
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.notify();
    try {
      const page = await this.ctx.api.loadHandins(this.code, since);
      if (generation !== this.loadGeneration) return;
      this.items = [...page.items].sort(newestFirst);
      this.hasMore = page.hasMore;
      this.loading = false;
      if (this.error?.kind === 'period') this.error = null;
      void this.decode(this.items);
    } catch (err) {
      if (generation !== this.loadGeneration) return;
      this.loading = false;
      this.error = { kind: 'period', error: err as ClassroomError };
    }
    this.notify();
  }
  private loadGeneration = 0;

  /** The next page of a longer period (100 more). */
  async loadMore(): Promise<void> {
    if (this.period === 'today' || !this.hasMore || this.loading) return;
    const days = Number(this.period);
    const since = new Date(this.ctx.now().getTime() - days * 86_400_000);
    const last = this.items[this.items.length - 1];
    if (!last?.createdAt) return;
    this.loading = true;
    this.notify();
    try {
      const page = await this.ctx.api.loadHandins(this.code, since, { before: last.createdAt });
      const known = new Set(this.items.map((r) => r.id));
      this.items = [...this.items, ...page.items.filter((r) => !known.has(r.id))].sort(newestFirst);
      this.hasMore = page.hasMore;
      void this.decode(page.items);
    } catch (err) {
      this.ctx.showError(err);
    }
    this.loading = false;
    this.notify();
  }

  /**
   * EVERY hand-in of the class, page by page (100 per read batch), decoded: the zip downloads
   * that must be complete (before deleting the class, the retention warning). Rejects on a
   * failed page; `onProgress` reports the count loaded so far.
   */
  async loadAll(onProgress?: (count: number) => void): Promise<HandinRecord[]> {
    const since = new Date(0);
    const items: HandinRecord[] = [];
    let page = await this.ctx.api.loadHandins(this.code, since);
    items.push(...page.items);
    onProgress?.(items.length);
    while (page.hasMore) {
      const last = items[items.length - 1];
      if (!last?.createdAt) break;
      page = await this.ctx.api.loadHandins(this.code, since, { before: last.createdAt });
      items.push(...page.items);
      onProgress?.(items.length);
    }
    await this.cache.decodeAll(items);
    return items;
  }

  /** Decode records and notify when the cache changed. */
  async decode(items: readonly HandinRecord[]): Promise<void> {
    const fresh = items.filter((r) => this.cache.get(r.id) === undefined);
    if (fresh.length === 0) return;
    await this.cache.decodeAll(fresh);
    this.notify();
  }

  /** Add records loaded on demand (older versions) so the views and the zip know them. */
  addRecords(records: readonly HandinRecord[]): void {
    void this.decode(records);
  }

  /** A view that needs the members list calls this while visible, and the returned function when hidden. */
  useMembers(): Unsubscribe {
    this.membersUsers++;
    if (this.membersUsers === 1) this.subscribeMembers();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.membersUsers--;
      if (this.membersUsers === 0) {
        this.membersUnsub?.();
        this.membersUnsub = null;
        this.members = null;
      }
    };
  }

  private subscribeMembers(): void {
    if (this.stopped) return;
    this.membersUnsub = this.ctx.api.watchMembers(
      this.code,
      (members) => {
        this.members = members;
        if (this.error?.kind === 'members') this.error = null;
        this.notify();
      },
      (error) => {
        this.error = { kind: 'members', error };
        this.notify();
      },
    );
  }

  get membersWatched(): boolean {
    return this.membersUnsub !== null;
  }
}
