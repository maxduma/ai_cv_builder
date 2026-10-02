import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { BrandMarkIcon } from '../../ui/icons';
import { AuthAside } from './AuthAside';
import '../../app/layout.css';
import './auth.css';

/**
 * Frame of the Log in and Sign up pages: the form on the left, sample CVs on the right (hidden
 * below 1024px). It stays mounted when switching between the two forms, so only the form changes.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <main className="auth-main">
        <div className="auth-top">
          <Link to="/" className="brand" aria-label="CV Builder home">
            <span className="brand-mark" aria-hidden="true">
              <BrandMarkIcon />
            </span>
            <span className="brand-name">CV Builder</span>
          </Link>
        </div>
        <div className="auth-center">{children}</div>
      </main>
      <AuthAside />
    </div>
  );
}
