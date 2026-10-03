/** Joins the class names that are set: `classes('card', open && 'is-open')`. */
export function classes(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}
