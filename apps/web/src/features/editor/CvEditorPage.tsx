import { useParams } from 'react-router';
import { type ReadyCv, ReadyCvGate } from '../cvs/ReadyCvGate';
import { CvPreview } from './CvPreview';
import { EditorBar, PreviewLink, SaveStatusText } from './EditorBar';
import { estimatePages, pageLabel } from './estimate-pages';
import { QuestionsPanel } from './QuestionsPanel';
import { ContactSection } from './sections/ContactSection';
import { EducationSection } from './sections/EducationSection';
import { ExperienceSection } from './sections/ExperienceSection';
import { SkillsSection } from './sections/SkillsSection';
import { SummarySection } from './sections/SummarySection';
import { UndoToast } from './UndoToast';
import { useEditorSession } from './useEditorSession';
import './editor.css';

const SECTIONS = [
  ['contact', 'Contact'],
  ['summary', 'Summary'],
  ['experience', 'Experience'],
  ['education', 'Education'],
  ['skills', 'Skills'],
] as const;

/**
 * `/cvs/:cvId/editor`: the structured editor of a generated CV, with its live preview. Edits save
 * themselves; the AI's questions wait at the top, and an answer updates its section in the
 * background while editing goes on.
 */
export function CvEditorPage() {
  const { cvId = '' } = useParams();
  return (
    <ReadyCvGate cvId={cvId} loadingClassName="ed-main">
      {(cv) => <Editor key={cv.id} cv={cv} />}
    </ReadyCvGate>
  );
}

function Editor({ cv }: { cv: ReadyCv }) {
  const [{ draft, status, errors, undo, live }, session] = useEditorSession(cv);
  const pages = pageLabel(estimatePages(draft).pages);

  const retry = () => session.retry();
  const sectionProps = { draft, errors, session };

  return (
    <>
      <title>{`${cv.title} · CV Builder`}</title>
      <EditorBar cv={cv} status={status} onRetry={retry} />
      <main className="ed-main">
        <div className="ed-grid">
          <div className="ed-form">
            <nav className="sec-nav" aria-label="CV sections">
              {SECTIONS.map(([key, label]) => (
                <a key={key} href={`#sec-${key}`} className="sec-link">
                  {label}
                </a>
              ))}
            </nav>
            <QuestionsPanel cv={cv} draft={draft} session={session} />
            <ContactSection {...sectionProps} />
            <SummarySection {...sectionProps} />
            <ExperienceSection {...sectionProps} />
            <EducationSection {...sectionProps} />
            <SkillsSection {...sectionProps} />
          </div>
          <CvPreview cvId={cv.id} content={draft} />
        </div>
      </main>

      {/* Below 1024px the preview is hidden; the save status and the way on move down here. */}
      <div className="ed-mbar">
        <div className="ed-mbar-in">
          <SaveStatusText status={status} savedLabel={`${pages} · saved`} onRetry={retry} />
          <PreviewLink cvId={cv.id} />
        </div>
      </div>

      <UndoToast undo={undo} session={session} />
      <p className="sr-only" role="status" aria-live="polite">
        {/* A different text each time, so a repeated message is announced again. */}
        {live.text + (live.seq % 2 ? '​' : '')}
      </p>
    </>
  );
}
