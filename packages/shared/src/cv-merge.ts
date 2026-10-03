import type { CvContent } from './cv-content';

type Item = { id: string } & Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A list whose entries are identified by `id` (roles, bullets, links, skills...). */
const isItemList = (value: unknown): value is Item[] =>
  Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string');

/** Structural equality of JSON values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((value, i) => deepEqual(value, b[i]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
    );
  }
  return false;
}

/**
 * Three-way merge of two edited copies of the same CV, `ours` and `theirs`, made from `base`.
 *
 * - A value only one side changed takes that side's change. When both changed it differently,
 *   `ours` wins: callers pass the person's own edits as `ours` (the editor's unsaved draft, or the
 *   CV as it is now when an AI update lands), so a manual edit is never overwritten.
 * - Lists merge entry by entry, by id. An entry one side added is kept; an entry one side deleted
 *   stays deleted, unless the other side edited it meanwhile.
 * - Order comes from `ours` only if `ours` reordered entries it shares with `base` (Move up/down);
 *   otherwise from `theirs`, so a reorder made elsewhere survives. Entries the other side added go
 *   in front of their next neighbour from that side, or at the end.
 *
 * `merge(b, x, x)`, `merge(b, b, t)` and `merge(b, o, b)` give `x`, `t` and `o`.
 */
export function mergeCvContent(base: CvContent, ours: CvContent, theirs: CvContent): CvContent {
  const merged = mergeValues(base, ours, theirs) as CvContent;
  const roleIn = (cv: CvContent, id: string) => cv.experience.find((role) => role.id === id);
  return {
    ...merged,
    experience: merged.experience.map((role) => {
      // Whether a role is current and its end date go together: if ours changed either, ours
      // decides both (an end date typed by hand isn't cleared by the other side's "current").
      const before = roleIn(base, role.id);
      const mine = roleIn(ours, role.id);
      const pair = mine && before && (mine.current !== before.current || mine.end !== before.end);
      const { current, end } = pair ? mine : role;
      // A current role has no end date.
      return { ...role, current, end: current ? '' : end };
    }),
  };
}

function mergeValues(base: unknown, ours: unknown, theirs: unknown): unknown {
  if (deepEqual(ours, theirs)) return ours;
  if (deepEqual(base, ours)) return theirs;
  if (deepEqual(base, theirs)) return ours;

  // Both sides changed it, differently.
  if (isRecord(ours) && isRecord(theirs)) {
    const before = isRecord(base) ? base : {};
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const value = mergeValues(before[key], ours[key], theirs[key]);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  if (isItemList(ours) && isItemList(theirs)) {
    return mergeLists(isItemList(base) ? base : [], ours, theirs);
  }
  return ours;
}

function mergeLists(base: Item[], ours: Item[], theirs: Item[]): Item[] {
  const inBase = new Map(base.map((item) => [item.id, item]));
  const inOurs = new Map(ours.map((item) => [item.id, item]));
  const inTheirs = new Map(theirs.map((item) => [item.id, item]));

  const survivors = new Map<string, Item>();
  for (const item of ours) {
    const other = inTheirs.get(item.id);
    const original = inBase.get(item.id);
    if (other) {
      // An entry new to both (an echo of our own earlier save) merges as if `theirs` were its base.
      survivors.set(item.id, mergeValues(original ?? other, item, other) as Item);
    } else if (!original || !deepEqual(original, item)) {
      // Ours added it, or edited it while theirs deleted it: the edit keeps it.
      survivors.set(item.id, item);
    }
  }
  for (const item of theirs) {
    // Theirs added it; one that is in `base` but not in `ours` was deleted by ours.
    if (!inOurs.has(item.id) && !inBase.has(item.id)) survivors.set(item.id, item);
  }

  const sharedOrder = ours.filter((item) => inBase.has(item.id)).map((item) => item.id);
  const baseOrder = base.filter((item) => inOurs.has(item.id)).map((item) => item.id);
  const oursReordered = !deepEqual(sharedOrder, baseOrder);
  const [primary, secondary] = oursReordered ? [ours, theirs] : [theirs, ours];

  const order = primary.map((item) => item.id).filter((id) => survivors.has(id));
  const placed = new Set(order);
  secondary.forEach((item, index) => {
    if (placed.has(item.id) || !survivors.has(item.id)) return;
    const next = secondary.slice(index + 1).find((later) => placed.has(later.id));
    const at = next ? order.indexOf(next.id) : order.length;
    order.splice(at, 0, item.id);
    placed.add(item.id);
  });

  return order.map((id) => survivors.get(id) as Item);
}

/**
 * Where two CVs differ, as readable paths: `summary`, `contact.email`, `experience.<id>.title`,
 * `experience.<id>.bullets.<id>` (an entry added or removed). For logs and job results.
 */
export function changedPaths(before: CvContent, after: CvContent): string[] {
  const paths: string[] = [];
  collectChanges(before, after, '', paths);
  return paths;
}

function collectChanges(before: unknown, after: unknown, path: string, paths: string[]) {
  if (deepEqual(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      collectChanges(before[key], after[key], join(path, key), paths);
    }
    return;
  }
  if (isItemList(before) && isItemList(after)) {
    const earlier = new Map(before.map((item) => [item.id, item]));
    const later = new Map(after.map((item) => [item.id, item]));
    for (const id of new Set([...earlier.keys(), ...later.keys()])) {
      const a = earlier.get(id);
      const b = later.get(id);
      if (a && b) collectChanges(a, b, join(path, id), paths);
      else paths.push(join(path, id));
    }
    const order = (items: Item[]) =>
      items.filter((item) => later.has(item.id) && earlier.has(item.id));
    if (
      !deepEqual(
        order(before).map((i) => i.id),
        order(after).map((i) => i.id),
      )
    ) {
      paths.push(join(path, '(order)'));
    }
    return;
  }
  paths.push(path);
}

const join = (path: string, key: string) => (path ? `${path}.${key}` : key);
