/**
 * A random id for a new CV entry (role, achievement, school, skill, link): a UUID v4.
 *
 * `crypto.randomUUID` exists only in secure contexts (HTTPS or localhost), and the dev server
 * opened from a phone at `http://<computer-ip>:5173` is neither, so it falls back to
 * `crypto.getRandomValues`, which works everywhere. Checked on every call, not once at load.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
