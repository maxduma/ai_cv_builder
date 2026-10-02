import { Link, NavLink, Outlet } from 'react-router';
import { BrandMarkIcon } from '../ui/icons';
import './layout.css';

/** Page chrome from the design: a sticky, translucent header; each page renders its own `<main>`. */
export function AppLayout() {
  return (
    <>
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
        </div>
      </header>
      <Outlet />
    </>
  );
}
