import { PASSWORD_MIN_LENGTH } from '@cv-builder/shared';

const LEVELS = [
  { label: 'Weak', color: 'var(--danger)', ink: 'var(--danger-ink)' },
  { label: 'Fair', color: 'var(--warning)', ink: 'var(--warning-ink)' },
  { label: 'Good', color: 'var(--success)', ink: 'var(--success-ink)' },
  { label: 'Strong', color: 'var(--success-ink)', ink: 'var(--success-ink)' },
];

const SEGMENTS = [0, 1, 2, 3];

/**
 * The design's strength score: 0 for no password, 1 (Weak) while it's too short, then a point
 * each for 12+ characters, mixed case, and a digit or symbol — up to 4 (Strong).
 */
function passwordScore(password: string): number {
  if (!password) return 0;
  if (password.length < PASSWORD_MIN_LENGTH) return 1;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

/** Four segments that fill and change colour as the password gets stronger. */
export function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const level = LEVELS[score - 1];

  return (
    <>
      <div className="pw-meter" aria-hidden="true">
        <div className="meter">
          {SEGMENTS.map((index) => (
            <span
              key={index}
              className="meter-seg"
              style={level && index < score ? { backgroundColor: level.color } : undefined}
            />
          ))}
        </div>
        <span className="meter-label" style={level && { color: level.ink }}>
          {level?.label}
        </span>
      </div>
      {/* The meter is hidden from screen readers; this announces each change of level instead. */}
      <span className="sr-only" aria-live="polite">
        {level ? `Password strength: ${level.label}` : ''}
      </span>
    </>
  );
}
