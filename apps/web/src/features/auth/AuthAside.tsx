import type { CSSProperties } from 'react';
import { StatusChip } from '../../ui/StatusChip';
import '../../ui/cv-mini-page.css';

function Bar({ className = 'b', width }: { className?: string; width: string }) {
  return <span className={className} style={{ width }} />;
}

/** Where a page sits around the stage's centre, and when it rises in. */
function slot(left: number, top: number, delayMs: number): CSSProperties {
  return { left, top, animationDelay: `${delayMs}ms` };
}

/** Two columns: contact, skills and languages in a tinted sidebar. */
function SplitPage() {
  return (
    <div className="pv-split">
      <div className="pv-side">
        <span className="pv-avatar" />
        <Bar className="b b-ct" width="88%" />
        <Bar className="b b-ct" width="66%" />
        <Bar className="b b-ct" width="78%" />
        <p className="pv-h" style={{ margin: '10px 0 2px' }}>
          Skills
        </p>
        <Bar className="b b-ac" width="74%" />
        <Bar className="b b-ac" width="58%" />
        <Bar className="b b-ac" width="82%" />
        <Bar className="b b-ac" width="50%" />
        <p className="pv-h" style={{ margin: '10px 0 2px' }}>
          Languages
        </p>
        <Bar className="b b-ct" width="62%" />
        <Bar className="b b-ct" width="70%" />
      </div>
      <div className="pv-main">
        <p className="pv-name-text" style={{ fontSize: 10.5 }}>
          Alex Morgan
        </p>
        <p className="pv-role">React Native Developer</p>
        <span className="pv-rule" style={{ margin: '10px 0 9px' }} />
        <p className="pv-h">Experience</p>
        <div className="pv-row">
          <Bar className="b b-dk" width="52%" />
          <Bar className="b b-dt" width="18%" />
        </div>
        <div className="pv-lines">
          <Bar width="96%" />
          <Bar width="86%" />
          <Bar width="92%" />
        </div>
        <div className="pv-row" style={{ marginTop: 8 }}>
          <Bar className="b b-dk" width="44%" />
          <Bar className="b b-dt" width="18%" />
        </div>
        <div className="pv-lines">
          <Bar width="90%" />
          <Bar width="72%" />
        </div>
        <p className="pv-h" style={{ marginTop: 10 }}>
          Education
        </p>
        <div className="pv-row">
          <Bar className="b b-dk" width="48%" />
          <Bar className="b b-dt" width="18%" />
        </div>
      </div>
    </div>
  );
}

/** Centred, with a section still to fill in. */
function CenteredPage() {
  return (
    <div className="pv pv-center">
      <p className="pv-name-text">Alex Morgan</p>
      <p className="pv-role">AI Engineer</p>
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
        <svg width="9" height="9" viewBox="0 0 10 10">
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

/** The finished CV in front. */
function ClassicPage() {
  return (
    <div className="pv">
      <p className="pv-name-text">Alex Morgan</p>
      <p className="pv-role">Senior Backend Engineer</p>
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

/**
 * The brand panel beside the auth forms: three sample CVs floating over a dotted backdrop, and the
 * product's promise. Decorative, so hidden from screen readers; below 1024px it isn't shown.
 */
export function AuthAside() {
  return (
    <aside className="auth-aside" aria-hidden="true">
      <div className="aside-stage">
        <div className="aside-slot" style={slot(-304, -150, 160)}>
          <div className="aside-float" style={{ animationDelay: '-1.4s' }}>
            <div className="aside-page" style={{ transform: 'rotate(-9deg)' }}>
              <SplitPage />
            </div>
          </div>
        </div>
        <div className="aside-slot" style={slot(68, -140, 240)}>
          <div className="aside-float" style={{ animationDelay: '-3.2s' }}>
            <div className="aside-page" style={{ transform: 'rotate(8deg)' }}>
              <CenteredPage />
            </div>
          </div>
        </div>
        <div className="aside-slot" style={slot(-118, -196, 80)}>
          <div className="aside-float">
            <div className="aside-page">
              <ClassicPage />
            </div>
            <StatusChip status="ready" className="aside-chip" />
          </div>
        </div>
      </div>
      <div className="aside-caption auth-in" style={{ animationDelay: '320ms' }}>
        <p className="aside-title">Turn your experience into a professional CV with AI.</p>
      </div>
    </aside>
  );
}
