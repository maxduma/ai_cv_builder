import { Link } from 'react-router';
import { ArrowLeftIcon, MissingPageIcon } from '../ui/icons';
import { StateIcon, StatePanel } from '../ui/StatePanel';
import '../app/layout.css';

export function NotFoundPage() {
  return (
    <main className="page-main">
      <title>Page not found · CV Builder</title>
      <StatePanel
        headingLevel="h1"
        visual={
          <StateIcon tone="neutral">
            <MissingPageIcon />
          </StateIcon>
        }
        title="Page not found"
        description="The page you’re looking for doesn’t exist or has moved."
        action={
          <Link to="/" className="btn btn-primary empty-cta">
            <ArrowLeftIcon />
            <span>Back to My CVs</span>
          </Link>
        }
      />
    </main>
  );
}
