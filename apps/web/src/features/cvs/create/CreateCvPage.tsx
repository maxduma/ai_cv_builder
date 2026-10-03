import { Navigate, useParams } from 'react-router';
import { ApiError } from '../../../lib/api-client';
import { NotFoundPage } from '../../../pages/NotFoundPage';
import { useCv } from '../api';
import { CvFormPage } from './CvFormPage';

/** `/cvs/new` */
export function CreateCvPage() {
  return <CvFormPage initial={null} />;
}

/** `/cvs/:cvId/edit`: the same form for a draft, or after a failed generation ("Edit details"). */
export function EditCvPage() {
  const { cvId = '' } = useParams();
  const { data: cv, error } = useCv(cvId);

  // A failed background refetch keeps the form, and what was typed into it, on screen: only a
  // first load can fail here.
  if (!cv) {
    if (error) {
      // An unknown or malformed id, or someone else's CV.
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        return <NotFoundPage />;
      }
      throw error;
    }
    return <main className="page-main is-form" aria-busy="true" />;
  }
  // While it generates, the CV's page is its status screen; once it's done, the editor.
  if (cv.status === 'generating') {
    return <Navigate to={`/cvs/${cv.id}`} replace />;
  }
  if (cv.status === 'ready') {
    return <Navigate to={`/cvs/${cv.id}/editor`} replace />;
  }
  return <CvFormPage key={cv.id} initial={cv} />;
}
