import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { BrandMarkIcon } from '../ui/icons';
import './layout.css';

/**
 * The sticky, translucent header from the design. `children` go on the right: the account menu,
 * or nothing while the session can't be checked.
 */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="app-header cvb-fade">
      <div className="app-bar">
        <Link to="/" className="brand" aria-label="CV Builder home">
          <span className="brand-mark" aria-hidden="true">
            <BrandMarkIcon />
          </span>
          <span className="brand-name">CV Builder</span>
        </Link>
        <nav className="app-nav" aria-label="Primary">
          <NavLink to="/" end className="nav-link">
            My CVs
          </NavLink>
        </nav>
        {children}
      </div>
    </header>
  );
}
