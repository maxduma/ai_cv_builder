import { describe, expect, it } from 'vitest';
import { menuKeyAction } from './card-menu-keys';

const key = (
  name: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', true>> = {},
) => ({
  key: name,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...modifiers,
});

describe('menuKeyAction', () => {
  it('renames on R, in either case', () => {
    expect(menuKeyAction(key('r'), -1, 2)).toEqual({ kind: 'rename' });
    expect(menuKeyAction(key('R'), 0, 2)).toEqual({ kind: 'rename' });
  });

  it('asks to delete on Delete and on Backspace', () => {
    expect(menuKeyAction(key('Delete'), -1, 2)).toEqual({ kind: 'delete' });
    expect(menuKeyAction(key('Backspace'), 1, 2)).toEqual({ kind: 'delete' });
  });

  it('moves focus down and up, wrapping around', () => {
    // From the ⋯ button nothing is focused yet: the first item is next, and the last is before it.
    expect(menuKeyAction(key('ArrowDown'), -1, 2)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction(key('ArrowDown'), 0, 2)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKeyAction(key('ArrowDown'), 1, 2)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction(key('ArrowUp'), -1, 2)).toEqual({ kind: 'focus', index: 1 });
    expect(menuKeyAction(key('ArrowUp'), 1, 2)).toEqual({ kind: 'focus', index: 0 });
    expect(menuKeyAction(key('ArrowUp'), 0, 2)).toEqual({ kind: 'focus', index: 1 });
  });

  it('has nowhere to move focus without items', () => {
    expect(menuKeyAction(key('ArrowDown'), -1, 0)).toBeNull();
    expect(menuKeyAction(key('ArrowUp'), -1, 0)).toBeNull();
  });

  it('leaves browser shortcuts alone: ⌘R reloads, Ctrl+Backspace deletes a word', () => {
    expect(menuKeyAction(key('r', { metaKey: true }), -1, 2)).toBeNull();
    expect(menuKeyAction(key('r', { ctrlKey: true }), -1, 2)).toBeNull();
    expect(menuKeyAction(key('Backspace', { altKey: true }), -1, 2)).toBeNull();
  });

  it('ignores every other key', () => {
    for (const other of ['Enter', 'Tab', 'a', 'Escape', ' ']) {
      expect(menuKeyAction(key(other), 0, 2), other).toBeNull();
    }
  });
});
