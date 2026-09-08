/**
 * "Examples ▾" dropdown in the header: example sketches grouped by topic.
 *
 * The menu is generic over the example shape so that the same dropdown lists
 * text sketches (`Example`) in Code mode and block workspaces (`BlockExample`)
 * in Blocks mode; `setExamples()` swaps the list when the mode changes.
 */

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
  container.classList.add('z1-menu');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'z1-btn';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Open the examples menu');
  trigger.innerHTML = 'Examples <span aria-hidden="true">▾</span>';

  const list = document.createElement('div');
  list.className = 'z1-menu-list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Example sketches');
  list.hidden = true;

  let items: HTMLButtonElement[] = [];

  function build(source: readonly T[]): void {
    items = [];
    list.replaceChildren();
    for (const group of groupExamples(source)) {
      const section = document.createElement('div');
      section.className = 'z1-menu-group';
      section.setAttribute('role', 'group');
      section.setAttribute('aria-label', group.group);
      const heading = document.createElement('div');
      heading.className = 'z1-menu-group-title';
      heading.textContent = group.group;
      section.appendChild(heading);
      for (const ex of group.items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'z1-menu-item';
        item.setAttribute('role', 'menuitem');
        item.textContent = ex.title;
        item.title = ex.description;
        item.addEventListener('click', () => {
          close();
          onSelect(ex);
        });
        section.appendChild(item);
        items.push(item);
      }
      list.appendChild(section);
    }
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'z1-menu-empty';
      empty.textContent = 'No examples available';
      list.appendChild(empty);
    }
  }
  build(examples);

  container.append(trigger, list);

  const onDocumentPointerDown = (e: PointerEvent): void => {
    if (!container.contains(e.target as Node)) close();
  };
  const onListKeyDown = (e: KeyboardEvent): void => {
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  function open(): void {
    if (!list.hidden) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onDocumentPointerDown);
    items[0]?.focus();
  }
  function close(): void {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocumentPointerDown);
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', onListKeyDown);

  return {
    open,
    close,
    isOpen: () => !list.hidden,
    setExamples(next) {
      close();
      build(next);
    },
    destroy() {
      close();
      container.replaceChildren();
    },
  };
}
