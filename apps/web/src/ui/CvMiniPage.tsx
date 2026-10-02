import './cv-mini-page.css';

function Bar({ className = 'b', width }: { className?: string; width: string }) {
  return <span className={className} style={{ width }} />;
}

function Role({ role }: { role: string | null }) {
  return role ? (
    <p className="pv-role">{role}</p>
  ) : (
    <Bar className="b b-ghost pv-role-ghost" width="52%" />
  );
}

/**
 * Thumbnail of an A4 CV page. `classic` is a written CV; `draft` is one that still has gaps
 * (no content yet), with a dashed "to do" block like the design's draft card.
 */
export function CvMiniPage({
  variant,
  role,
}: {
  variant: 'classic' | 'draft';
  role: string | null;
}) {
  if (variant === 'draft') {
    return (
      <div className="pv pv-center">
        <Bar className="pv-name" width="44%" />
        <Role role={role} />
        <div className="pv-contact">
          <Bar className="b b-ct" width="24%" />
          <Bar className="b b-ct" width="20%" />
        </div>
        <span className="pv-rule" />
        <div className="pv-block">
          <p className="pv-h">Experience</p>
          <div className="pv-row">
            <Bar className="b b-dk" width="44%" />
            <Bar className="b b-dt" width="15%" />
          </div>
          <div className="pv-lines">
            <Bar width="92%" />
            <Bar width="70%" />
          </div>
        </div>
        <div className="pv-todo" style={{ marginTop: 10 }}>
          <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M5 1.5V8.5M1.5 5H8.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="pv-block" style={{ marginTop: 10 }}>
          <p className="pv-h">Skills</p>
          <div className="pv-chips">
            <Bar className="pv-chip" width="24px" />
            <Bar className="pv-chip" width="18px" />
            <Bar className="pv-chip pv-chip-empty" width="26px" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pv">
      <Bar className="pv-name" width="48%" />
      <Role role={role} />
      <div className="pv-contact">
        <Bar className="b b-ct" width="26%" />
        <Bar className="b b-ct" width="20%" />
        <Bar className="b b-ct" width="24%" />
      </div>
      <span className="pv-rule" />
      <p className="pv-h">Experience</p>
      <div className="pv-row">
        <Bar className="b b-dk" width="46%" />
        <Bar className="b b-dt" width="15%" />
      </div>
      <div className="pv-lines">
        <Bar width="96%" />
        <Bar width="88%" />
        <Bar width="92%" />
      </div>
      <div className="pv-row" style={{ marginTop: 9 }}>
        <Bar className="b b-dk" width="40%" />
        <Bar className="b b-dt" width="15%" />
      </div>
      <div className="pv-lines">
        <Bar width="94%" />
        <Bar width="78%" />
      </div>
      <p className="pv-h" style={{ marginTop: 11 }}>
        Skills
      </p>
      <div className="pv-chips">
        <Bar className="pv-chip" width="22px" />
        <Bar className="pv-chip" width="28px" />
        <Bar className="pv-chip" width="18px" />
        <Bar className="pv-chip" width="30px" />
        <Bar className="pv-chip" width="20px" />
      </div>
    </div>
  );
}
