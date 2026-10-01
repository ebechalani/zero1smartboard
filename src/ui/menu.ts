/**
 * Header dropdown: a "Label ▾" trigger button and an absolutely positioned
 * list of items (`role="menu"`), optionally in titled groups. Shared by the
 * Examples, Share and Settings menus of the header (docs/ARCHITECTURE.md §8.3).
 *
 * Behaviour: the trigger toggles the list; ArrowDown on the trigger opens it;
 * the list closes on a click on an item (after calling its `onSelect`), on a
 * pointer down outside the menu, on Esc (the focus goes back to the trigger)
 * and on Tab. Arrow keys, Home and End move between the items.
 */

export interface MenuItem {
  label: string;
  /** Tooltip (`title`). */
  title?: string;
  onSelect(): void;
}

export interface MenuGroup {
  /** The group heading; none for a flat list. */
  title?: string;
  items: MenuItem[];
}

export interface MenuOptions {
  /** The visible label of the trigger, e.g. "Share" (before the ▾). */
  label: string;
  /** An icon (`aria-hidden`) before the label. */
  icon?: string;
  /** `aria-label` of the trigger. */
  ariaLabel: string;
  /** Tooltip of the trigger. */
  title?: string;
  /** `aria-label` of the list. */
  listLabel: string;
  /** Shown instead of the items when there is none. */
  empty?: string;
  /** A short flat list as wide as its items (default: the 280 px examples width). */
  compact?: boolean;
}

export interface Menu {
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Replace the items (closes the menu when it is open); `empty` replaces the options' text shown when there is none. */
  setItems(groups: readonly MenuGroup[], empty?: string): void;
  destroy(): void;
  /** The "Label ▾" button (the App updates its label, aria-label and title). */
  readonly trigger: HTMLButtonElement;
}

/**
 * Mount the dropdown into `container` (which becomes the `.z1-menu` anchor).
 */
export function createMenu(container: HTMLElement, options: MenuOptions, groups: readonly MenuGroup[] = []): Menu {
  container.classList.add('z1-menu');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'z1-btn';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', options.ariaLabel);
  if (options.title) trigger.title = options.title;
  if (options.icon) {
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = options.icon;
    trigger.append(icon, ' ');
  }
  const label = document.createElement('span');
  label.className = 'z1-btn-label';
  label.textContent = options.label;
  const caret = document.createElement('span');
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  trigger.append(label, ' ', caret);

  const list = document.createElement('div');
  list.className = options.compact ? 'z1-menu-list z1-menu-compact' : 'z1-menu-list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', options.listLabel);
  list.hidden = true;

  let items: HTMLButtonElement[] = [];

  /** The text shown when there is no item, set by the last setItems() (else options.empty). */
  let emptyNow: string | undefined;

  function build(source: readonly MenuGroup[]): void {
    items = [];
    list.replaceChildren();
    for (const group of source) {
      let host: HTMLElement = list;
      if (group.title !== undefined) {
        host = document.createElement('div');
        host.className = 'z1-menu-group';
        host.setAttribute('role', 'group');
        host.setAttribute('aria-label', group.title);
        const heading = document.createElement('div');
        heading.className = 'z1-menu-group-title';
        heading.textContent = group.title;
        host.appendChild(heading);
        list.appendChild(host);
      }
      for (const entry of group.items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'z1-menu-item';
        item.setAttribute('role', 'menuitem');
        item.textContent = entry.label;
        if (entry.title) item.title = entry.title;
        item.addEventListener('click', () => {
          close();
          entry.onSelect();
        });
        host.appendChild(item);
        items.push(item);
      }
    }
    const emptyText = emptyNow ?? options.empty;
    if (items.length === 0 && emptyText) {
      const empty = document.createElement('div');
      empty.className = 'z1-menu-empty';
      empty.textContent = emptyText;
      list.appendChild(empty);
    }
  }
  build(groups);

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
    setItems(next, empty) {
      close();
      emptyNow = empty;
      build(next);
    },
    destroy() {
      close();
      container.replaceChildren();
    },
    trigger,
  };
}
