/**
 * "Examples ▾" dropdown in the header: example sketches grouped by topic.
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

export interface ExamplesMenu<T extends MenuExample = MenuExample> {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Replace the listed examples (closes the menu when it is open). */
  setExamples(examples: readonly T[]): void;
  destroy(): void;
}

/**
 * Mount the dropdown into `container`. `onSelect` is called with the chosen example.
 */
export function createExamplesMenu<T extends MenuExample>(
  container: HTMLElement,
  examples: readonly T[],
  onSelect: (example: T) => void,
): ExamplesMenu<T> {
  const groups = (source: readonly T[]): MenuGroup[] =>
    groupExamples(source).map((g) => ({
      title: g.group,
      items: g.items.map((ex) => ({ label: ex.title, title: ex.description, onSelect: () => onSelect(ex) })),
    }));
  const menu = createMenu(
    container,
    { label: 'Examples', ariaLabel: 'Open the examples menu', listLabel: 'Example sketches', empty: 'No examples available' },
    groups(examples),
  );
  return {
    open: menu.open,
    close: menu.close,
    isOpen: menu.isOpen,
    setExamples: (next) => menu.setItems(groups(next)),
    destroy: menu.destroy,
  };
}
