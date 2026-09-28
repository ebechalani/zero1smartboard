// @vitest-environment happy-dom
/**
 * Header dropdown tests (happy-dom, src/ui/menu.ts): the trigger, the list
 * and its groups, the keyboard (arrows, Home/End, Esc, Tab), closing on a
 * click outside or on a selection, setItems and destroy. The Examples,
 * Settings and Share menus of the header are built on it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenu, type MenuGroup } from '../src/ui/menu';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function setup(groups?: MenuGroup[], compact?: boolean) {
  const chosen: string[] = [];
  const item = (label: string) => ({ label, title: `${label} tip`, onSelect: () => chosen.push(label) });
  const container = mount();
  const menu = createMenu(
    container,
    { icon: '🔗', label: 'Share', ariaLabel: 'Open the share menu', title: 'Share it', listLabel: 'Share your work', empty: 'Nothing here', compact },
    groups ?? [{ items: [item('Hand in'), item('Copy link'), item('Download')] }],
  );
  const items = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  const key = (target: Element, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { menu, container, chosen, items, key, list: container.querySelector<HTMLElement>('[role="menu"]')! };
}

describe('header menu', () => {
  it('builds a "Label ▾" trigger and a hidden list of items', () => {
    const { menu, container, items, list } = setup();
    expect(container.classList.contains('z1-menu')).toBe(true);
    const trigger = menu.trigger;
    expect(container.firstElementChild).toBe(trigger);
    expect(trigger.type).toBe('button');
    expect(trigger.textContent!.replace(/\s+/g, ' ').trim()).toBe('🔗 Share ▾');
    expect(trigger.querySelector('.z1-btn-label')!.textContent).toBe('Share');
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-label')).toBe('Open the share menu');
    expect(trigger.title).toBe('Share it');
    expect(list.hidden).toBe(true);
    expect(list.getAttribute('aria-label')).toBe('Share your work');
    expect(list.classList.contains('z1-menu-compact')).toBe(false);
    expect(items().map((i) => i.textContent)).toEqual(['Hand in', 'Copy link', 'Download']);
    expect(items()[1].title).toBe('Copy link tip');
    expect(container.querySelector('.z1-menu-group')).toBeNull(); // a flat list: no group wrapper
    expect(menu.isOpen()).toBe(false);
  });

  it('is compact and lays out titled groups when asked', () => {
    const { list, container } = setup([{ title: 'Outputs', items: [{ label: 'Blink', onSelect: () => {} }] }, { title: 'Inputs', items: [{ label: 'Button', onSelect: () => {} }] }], true);
    expect(list.classList.contains('z1-menu-compact')).toBe(true);
    const groups = Array.from(container.querySelectorAll('.z1-menu-group'));
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Outputs', 'Inputs']);
    expect(groups.map((g) => g.querySelector('.z1-menu-group-title')!.textContent)).toEqual(['Outputs', 'Inputs']);
    expect(groups[0].querySelector('[role="menuitem"]')!.textContent).toBe('Blink');
  });

  it('opens on click or ArrowDown with the first item focused, and selecting an item closes it', () => {
    const { menu, chosen, items, key, list } = setup();
    menu.trigger.click();
    expect(menu.isOpen()).toBe(true);
    expect(list.hidden).toBe(false);
    expect(menu.trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(items()[0]);
    menu.trigger.click();
    expect(menu.isOpen()).toBe(false);

    expect(key(menu.trigger, { key: 'ArrowDown' }).defaultPrevented).toBe(true);
    expect(menu.isOpen()).toBe(true);
    items()[1].click();
    expect(chosen).toEqual(['Copy link']);
    expect(menu.isOpen()).toBe(false);
    expect(menu.trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves between items with the arrows (wrapping), Home and End', () => {
    const { menu, items, key } = setup();
    menu.open();
    const [a, b, c] = items();
    expect(key(a, { key: 'ArrowDown' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b);
    key(b, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(c);
    key(c, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(a); // wraps
    key(a, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(c);
    key(c, { key: 'Home' });
    expect(document.activeElement).toBe(a);
    key(a, { key: 'End' });
    expect(document.activeElement).toBe(c);
    expect(menu.isOpen()).toBe(true);
  });

  it('Esc closes it, stops there and returns the focus to the trigger; Tab closes it', () => {
    const { menu, items, key } = setup();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    menu.open();
    const event = key(items()[1], { key: 'Escape' });
    expect(event.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled(); // never reaches the App's "Esc = stop" handler
    expect(menu.isOpen()).toBe(false);
    expect(document.activeElement).toBe(menu.trigger);

    menu.open();
    key(items()[0], { key: 'Tab' });
    expect(menu.isOpen()).toBe(false);
    document.removeEventListener('keydown', seen);
  });

  it('closes on a pointer down outside, not inside', () => {
    const { menu, items } = setup();
    menu.open();
    items()[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
    // Closed: an outside pointer down is no longer listened for (no throw, still closed).
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu.isOpen()).toBe(false);
  });

  it('setItems replaces the items (closing the menu) and shows the empty text; destroy empties the container', () => {
    const { menu, items, container, chosen } = setup();
    menu.open();
    menu.setItems([{ items: [{ label: 'Only', onSelect: () => chosen.push('Only') }] }]);
    expect(menu.isOpen()).toBe(false);
    expect(items().map((i) => i.textContent)).toEqual(['Only']);
    items()[0].click();
    expect(chosen).toEqual(['Only']);
    menu.setItems([]);
    expect(items()).toEqual([]);
    expect(container.querySelector('.z1-menu-empty')!.textContent).toBe('Nothing here');
    menu.destroy();
    expect(container.childElementCount).toBe(0);
  });
});
