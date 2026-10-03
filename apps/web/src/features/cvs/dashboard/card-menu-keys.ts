/** What a key does while a card's ⋯ menu is open, as the design describes (R, ⌫, ↑ and ↓). */
export type MenuKeyAction =
  { kind: 'rename' } | { kind: 'delete' } | { kind: 'focus'; index: number };

/**
 * `at` is the focused item (-1 when none is focused yet, e.g. focus is still on the ⋯ button);
 * the arrows wrap around. Other keys, and any key held with Ctrl, Alt or ⌘, do nothing here, so
 * browser shortcuts keep working.
 */
export function menuKeyAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  at: number,
  itemCount: number,
): MenuKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case 'r':
    case 'R':
      return { kind: 'rename' };
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };
    case 'ArrowDown':
      return itemCount > 0 ? { kind: 'focus', index: (at + 1) % itemCount } : null;
    case 'ArrowUp':
      return itemCount > 0 ? { kind: 'focus', index: at <= 0 ? itemCount - 1 : at - 1 } : null;
    default:
      return null;
  }
}
