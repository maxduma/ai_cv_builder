import type { CvDetail } from '@cv-builder/shared';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeftIcon } from '../../../ui/icons';
import { useCvs } from '../api';
import { DraftSummary, MobileActionBar } from './DraftSummary';
import { SourcePdfStep, SourceTextStep, TargetRoleStep } from './FormSteps';
import { useCvDraft } from './useCvDraft';
import './create.css';

const MAX_SUGGESTIONS = 3;

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * "Create a new CV": target role, then a PDF and/or a description, then Generate. `initial` is
 * an existing draft (the edit route); without it the draft is created on first use.
 */
export function CvFormPage({ initial }: { initial: CvDetail | null }) {
  const roleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const draft = useCvDraft(initial, { role: roleRef, text: textRef, drop: dropRef });
  const { data: cvList } = useCvs();

  // "From your CVs": target roles of the user's other CVs, newest first.
  const suggestions = [
    ...new Set(
      (cvList?.items ?? [])
        .filter((cv) => cv.id !== draft.cvId && cv.targetRole)
        .map((cv) => cv.targetRole as string),
    ),
  ].slice(0, MAX_SUGGESTIONS);

  // A PDF can be dropped anywhere on the page. Listening on the window also stops the browser
  // from opening a file dropped outside the drop zone, which would lose the form.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const canDrop = !draft.pdf && draft.submitState === 'idle';

  const onDragEnter = useEffectEvent((event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current += 1;
    if (canDrop) setDragging(true);
  });
  const onDragOver = useEffectEvent((event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
  });
  const onDragLeave = useEffectEvent((event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  });
  const onDrop = useEffectEvent((event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer?.files[0];
    if (file && canDrop) void draft.choosePdf(file);
  });

  useEffect(() => {
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <main className="page-main is-form">
      <title>Create a new CV · CV Builder</title>

      <Link to="/" className="back-link cvb-fade">
        <ArrowLeftIcon />
        <span>My CVs</span>
      </Link>
      <div className="create-head cvb-rise">
        <h1 className="page-title">Create a new CV</h1>
        <p className="page-sub">
          Pick the role you’re aiming for, then share your experience as a PDF, in your own words,
          or both. The AI writes a first draft you can edit.
        </p>
      </div>

      <div className="create-grid">
        <form
          className="create-form"
          noValidate
          aria-label="New CV details"
          onSubmit={(event) => {
            event.preventDefault();
            void draft.generate();
          }}
        >
          <TargetRoleStep
            draft={draft}
            suggestions={suggestions}
            inputRef={roleRef}
            onEnter={() => (dropRef.current ?? textRef.current)?.focus()}
          />
          <div className="step-link" aria-hidden="true" />
          <SourcePdfStep draft={draft} dragging={dragging && canDrop} dropRef={dropRef} />
          <div className="step-link is-or" aria-hidden="true">
            <span className="or-pill">and / or</span>
          </div>
          <SourceTextStep draft={draft} textRef={textRef} />
        </form>

        <DraftSummary draft={draft} />
      </div>

      <MobileActionBar draft={draft} />

      <p className="sr-only" role="status" aria-live="polite">
        {draft.live}
      </p>
    </main>
  );
}
