import { CV_TITLE_MAX_LENGTH, type CvSummary, cvTitle } from '@cv-builder/shared';
import { useRef, useState } from 'react';
import { errorMessage } from '../../../lib/api-client';
import { ErrorIcon } from '../../../ui/icons';
import { useRenameCv } from '../api';

interface Props {
  cv: CvSummary;
  /**
   * The field is closed. `renamedTo`: the name the API saved, or `null` if nothing changed.
   * `focusBack`: the keys closed it, so focus goes back to the card's ⋯ button.
   */
  onDone: (result: { renamedTo: string | null; focusBack: boolean }) => void;
}

/**
 * A card's title turned into a field, as in the design: Enter, or leaving the field, saves;
 * Escape cancels. An empty or unchanged name closes it without a request. If saving fails the
 * field stays open and says why, so nothing typed is lost.
 */
export function RenameField({ cv, onDone }: Props) {
  const [draft, setDraft] = useState(cv.title);
  const rename = useRenameCv();
  // Once the field is closed, the blur that follows (the browser may report one as the field is
  // removed) must not save again.
  const closed = useRef(false);
  const inputId = `rename-${cv.id}`;
  const hintId = `rename-hint-${cv.id}`;

  function close(renamedTo: string | null, focusBack: boolean) {
    closed.current = true;
    onDone({ renamedTo, focusBack });
  }

  function save(focusBack: boolean) {
    if (closed.current || rename.isPending) return;
    const title = cvTitle.safeParse(draft);
    if (!title.success || title.data === cv.title) {
      close(null, focusBack);
      return;
    }
    rename.mutate(
      { cvId: cv.id, title: title.data },
      { onSuccess: (saved) => close(saved.title, focusBack) },
    );
  }

  return (
    <>
      <label htmlFor={inputId} className="sr-only">
        CV name
      </label>
      <input
        id={inputId}
        className="rename-input"
        type="text"
        value={draft}
        maxLength={CV_TITLE_MAX_LENGTH}
        autoFocus
        autoComplete="off"
        enterKeyHint="done"
        readOnly={rename.isPending}
        aria-invalid={rename.isError || undefined}
        aria-describedby={hintId}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            save(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(null, true);
          }
        }}
        onBlur={() => save(false)}
      />
      {rename.isError ? (
        <p id={hintId} className="error cv-meta rename-error" role="alert">
          <ErrorIcon />
          <span>{errorMessage(rename.error)}</span>
        </p>
      ) : (
        <p id={hintId} className="cv-meta">
          <kbd className="kbd">↵</kbd>
          <span>save</span>
          <span aria-hidden="true">·</span>
          <kbd className="kbd">Esc</kbd>
          <span>cancel</span>
        </p>
      )}
    </>
  );
}
