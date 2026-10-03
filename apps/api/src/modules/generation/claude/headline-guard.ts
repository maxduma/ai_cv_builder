/** Lowercase letters and digits only: how titles are compared, whatever their spacing or punctuation. */
const compact = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The headline is the person's own job title, never the role they are applying for. A headline
 * that is only the target role ("Senior Backend Engineer" for someone applying to exactly that) is
 * the model putting a title on the person that nobody gave them, so it is cleared unless the
 * sources name that title too. Any other headline is left to the prompt and the person's review.
 */
export function guardHeadline(headline: string, targetRole: string, sources: string): string {
  const key = compact(headline);
  if (key === '' || key !== compact(targetRole)) return headline;
  return compact(sources).includes(key) ? headline : '';
}
