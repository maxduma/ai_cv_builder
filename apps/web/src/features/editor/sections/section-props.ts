import type { CvContent } from '@cv-builder/shared';
import type { EditorSession } from '../editor-session';

/** What every section of the editor gets. */
export interface SectionProps {
  /** The CV as the person sees it, unsaved edits included. */
  draft: CvContent;
  /** Problems with typed values, by path (`contact.email`); see `contentEditIssues`. */
  errors: Record<string, string>;
  /** All changes go through `session.edit`; `session.announce` speaks to screen readers. */
  session: EditorSession;
}
