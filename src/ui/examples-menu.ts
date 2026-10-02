/**
 * "＋ New ▾" dropdown in the header: a blank sketch first, then the example
 * sketches grouped by topic (New and Examples in one menu, by teacher request).
 *
 * The menu is generic over the example shape so that the same dropdown lists
 * text sketches (`Example`) in Code mode and block workspaces (`BlockExample`)
 * in Blocks mode; `setExamples()` swaps the list when the mode changes.
 * The dropdown itself is the shared header menu (menu.ts).
 */
import { createMenu, type MenuGroup } from './menu';

/** The fields the menu needs from an example (text or blocks). */
export interface MenuExample {
  id: string;
  title: string;
  group: string;
  description: string;
}

export interface ExampleGroup<T extends MenuExample = MenuExample> {
  group: string;
  items: T[];
}

/** Group examples by their `group` field, keeping first-seen order. */
export function groupExamples<T extends MenuExample>(examples: readonly T[]): ExampleGroup<T>[] {
  const groups: ExampleGroup<T>[] = [];
  for (const ex of examples) {
    let g = groups.find((x) => x.group === ex.group);
    if (!g) {
      g = { group: ex.group, items: [] };
      groups.push(g);
    }
    g.items.push(ex);
  }
  return groups;
}

/** The first item: start from a blank sketch / program (its words follow the mode). */
export interface NewItem {
  label: string;
  title: string;
  onSelect(): void;
}

export interface ExamplesMenu<T extends MenuExample = MenuExample> {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Replace the listed examples (closes the menu when it is open); `emptyText` replaces "No examples available" (e.g. "Loading…"). */
  setExamples(examples: readonly T[], emptyText?: string): void;
  /** Replace the words of the blank-sketch item (the mode changed). */
  setNewItem(item: NewItem): void;
  destroy(): void;
}

/**
 * Mount the dropdown into `container`. `onSelect` is called with the chosen example.
 */
export function createExamplesMenu<T extends MenuExample>(
  container: HTMLElement,
  examples: readonly T[],
  onSelect: (example: T) => void,
  newItem?: NewItem,
): ExamplesMenu<T> {
  let blank = newItem;
  let current = examples;
  let waiting: string | undefined;
  const groups = (): MenuGroup[] => {
    const list: MenuGroup[] = groupExamples(current).map((g) => ({
      title: g.group,
      items: g.items.map((ex) => ({ label: ex.title, title: ex.description, onSelect: () => onSelect(ex) })),
    }));
    if (!blank) return list;
    // With the blank item always there, "Loading…" / "No examples" become a heading under it.
    if (list.length === 0) list.push({ title: waiting ?? 'No examples available', items: [] });
    return [{ items: [{ label: blank.label, title: blank.title, onSelect: () => blank!.onSelect() }] }, ...list];
  };
  const menu = createMenu(
    container,
    blank
      ? { icon: '＋', label: 'New', ariaLabel: 'New: a blank sketch or an example', title: 'New: a blank sketch or an example', listLabel: 'New sketch or example', empty: 'No examples available' }
      : { label: 'Examples', ariaLabel: 'Open the examples menu', listLabel: 'Example sketches', empty: 'No examples available' },
    groups(),
  );
  return {
    open: menu.open,
    close: menu.close,
    isOpen: menu.isOpen,
    setExamples: (next, emptyText) => {
      current = next;
      waiting = emptyText;
      menu.setItems(groups(), emptyText);
    },
    setNewItem: (item) => {
      blank = item;
      menu.setItems(groups(), waiting);
    },
    destroy: menu.destroy,
  };
}
