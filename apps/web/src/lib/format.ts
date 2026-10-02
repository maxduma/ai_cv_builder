const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "just now", "2 hours ago", "yesterday", "Sep 28" — for "Updated …" and "Created …". */
export function formatRelativeTime(isoDate: string, now: number): string {
  const date = new Date(isoDate);
  const elapsed = Math.max(0, now - date.getTime());

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), 'day');

  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? monthDay : monthDayYear).format(date);
}

/** "184 KB", "2.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Elapsed time as "0:38". */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
