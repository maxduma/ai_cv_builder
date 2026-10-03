import type { CvContent, CvDetail } from '@cv-builder/shared';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../lib/api-client';
import { NotFoundPage } from '../../pages/NotFoundPage';
import { AlertCircleIcon, RetryIcon } from '../../ui/icons';
import { StateIcon, StatePanel } from '../../ui/StatePanel';
import { useCv, useQuestionUpdates } from '../cvs/api';
import { CvPreview } from './CvPreview';
import { EditorBar, SaveStatusText } from './EditorBar';
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
  const { data: cv, error, refetch, isFetching } = useCv(cvId);
  useQuestionUpdates(cv);

  // A failed background refetch keeps the CV on screen: only a first load can fail here.
  if (!cv) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
      return <NotFoundPage />;
    }
    if (error) {
      return (
        <main className="page-main">
          <StatePanel
            tone="error"
            headingLevel="h1"
            visual={
              <StateIcon tone="error">
                <AlertCircleIcon />
              </StateIcon>
            }
            title="We couldn’t open this CV"
            description="Your CV is safe — this is usually a connection problem. Check your internet and try again."
            action={
              <button
                type="button"
                className="btn btn-primary empty-cta"
                aria-busy={isFetching}
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RetryIcon />
                <span>Try again</span>
              </button>
            }
          />
        </main>
      );
    }
    return <main className="ed-main" aria-busy="true" />;
  }

  // Only a generated CV has anything to edit.
  if (cv.status === 'draft') return <Navigate to={`/cvs/${cv.id}/edit`} replace />;
  if (cv.status !== 'ready') return <Navigate to={`/cvs/${cv.id}`} replace />;
  if (!cv.content) {
    return (
      <main className="page-main">
        <StatePanel
          tone="error"
          headingLevel="h1"
          visual={
            <StateIcon tone="error">
              <AlertCircleIcon />
            </StateIcon>
          }
          title="We couldn’t open this CV"
          description="Its content couldn’t be read. Your other CVs aren’t affected."
          action={
            <Link to="/" className="btn btn-secondary">
              Back to My CVs
            </Link>
          }
        />
      </main>
    );
  }
  return <Editor key={cv.id} cv={{ ...cv, content: cv.content }} />;
}

function Editor({ cv }: { cv: CvDetail & { content: CvContent } }) {
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
          <CvPreview content={draft} />
        </div>
      </main>

      {/* Below 1024px the preview is hidden and the save status moves down here. */}
      <div className="ed-mbar">
        <div className="ed-mbar-in">
          <SaveStatusText status={status} savedLabel={`${pages} · saved`} onRetry={retry} />
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
