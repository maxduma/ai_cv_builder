import './state-panel.css';

type Variant = 'empty' | 'generating' | 'failed' | 'done';

const LINES = [
  { kind: 'name', width: '64%', delay: 0 },
  { kind: 'role', width: '42%', delay: 140 },
  { kind: 'gap' },
  { kind: 'body', width: '100%', delay: 280 },
  { kind: 'body', width: '86%', delay: 420 },
  { kind: 'body', width: '94%', delay: 560 },
  { kind: 'body', width: '60%', delay: 700 },
] as const;

/**
 * The floating CV page from the design's empty state and generation screens. It "types" its lines
 * while idle or working, and settles with a red or green badge once a generation has finished.
 */
export function FloatingDocArt({ variant }: { variant: Variant }) {
  const motion = variant === 'generating' ? ' is-busy' : variant === 'empty' ? '' : ' is-static';

  return (
    <div className={`doc-art${motion}`} aria-hidden="true">
      <span className="doc-art-shadow" />
      <div className="doc-art-float">
        <span className="doc-art-back" />
        <div className="doc-art-page">
          {LINES.map((line, index) =>
            line.kind === 'gap' ? (
              <span key={index} className="doc-art-gap" />
            ) : (
              <span
                key={index}
                className={`doc-art-line${line.kind === 'body' ? '' : ` is-${line.kind}`}`}
                style={{ width: line.width, animationDelay: `${line.delay}ms` }}
              />
            ),
          )}
        </div>
        <span className="doc-art-badge-wrap">
          {(variant === 'empty' || variant === 'generating') && <span className="doc-art-pulse" />}
          <Badge variant={variant} />
        </span>
      </div>
    </div>
  );
}

function Badge({ variant }: { variant: Variant }) {
  switch (variant) {
    case 'empty':
      return (
        <span className="doc-art-badge">
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path
              d="M7 2.75V11.25M2.75 7H11.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </span>
      );
    case 'generating':
      return (
        <span className="doc-art-badge">
          <svg width="15" height="15" viewBox="0 0 16 16">
            <path
              d="M7 2.25L8.15 5.6C8.35 6.15 8.7 6.5 9.25 6.7L12.6 7.85L9.25 9C8.7 9.2 8.35 9.55 8.15 10.1L7 13.45L5.85 10.1C5.65 9.55 5.3 9.2 4.75 9L1.4 7.85L4.75 6.7C5.3 6.5 5.65 6.15 5.85 5.6L7 2.25Z"
              fill="currentColor"
            />
            <path
              d="M12.75 1.25L13.25 2.75L14.75 3.25L13.25 3.75L12.75 5.25L12.25 3.75L10.75 3.25L12.25 2.75L12.75 1.25Z"
              fill="currentColor"
            />
          </svg>
        </span>
      );
    case 'failed':
      return (
        <span className="doc-art-badge is-danger">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M8 4V8.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="8" cy="11.75" r="1.1" fill="currentColor" />
          </svg>
        </span>
      );
    case 'done':
      return (
        <span className="doc-art-badge is-ok">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              d="M4 8.25L6.75 11L12 5.25"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      );
  }
}
