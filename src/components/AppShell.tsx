import { useEffect } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import { ClassGate } from './ClassGate';
import { Icon, ICON } from './Icon';
import { Tour, TOUR_EVENT } from './Tour';

type NavItem = [path: string, icon: keyof typeof ICON, label: string];

const NAV: NavItem[] = [
  ['/', 'home', 'หน้าแรก'],
  ['/code', 'convert', 'โค้ด'],
  ['/problems', 'problems', 'โจทย์'],
  ['/leaderboard', 'board', 'อันดับ'],
  ['/z80', 'z80', 'บอร์ด Z80'],
];
const TEACHER_NAV: NavItem[] = [['/teacher', 'users', 'อาจารย์']];

function isActive(path: string, current: string) {
  if (path === '/') return current === '/';
  return current === path || current.startsWith(path + '/');
}

export function AppShell() {
  const { loggedIn, user, isTeacher } = useAuth();
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!loggedIn) return <Navigate to="/login" replace state={{ from: pathname }} />;
  // students without an open class get the join page instead of the app
  if (user?.needsClass) return <ClassGate />;

  return (
    <div className="app">
      <nav aria-label="เมนูหลัก" className="rail">
        <Link to="/" aria-label="MIPS Lab หน้าแรก" className="rail-logo">
          <Icon d={ICON.chip} size={24} />
        </Link>
        {(isTeacher ? [...NAV, ...TEACHER_NAV] : NAV).map(([path, icon, label]) => {
          const active = isActive(path, pathname);
          return (
            <Link
              key={path}
              to={path}
              aria-current={active ? 'page' : undefined}
              className={`rail-item${active ? ' active' : ''}`}
            >
              <Icon d={ICON[icon]} size={22} />
              {label}
            </Link>
          );
        })}
        <span style={{ flex: 1 }} />
        <button className="rail-help" data-tour="help" aria-label="แนะนำหน้านี้" title="แนะนำหน้านี้" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}>
          ?
        </button>
        <Link
          to="/settings"
          className={`rail-avatar${pathname === '/settings' ? ' active' : ''}`}
          aria-label={`ตั้งค่าโปรไฟล์ (${user?.name ?? ''})`}
          aria-current={pathname === '/settings' ? 'page' : undefined}
          title={`${user?.name ?? ''} · ${ROLE_LABEL[user?.role ?? 'student']}
คลิกเพื่อตั้งค่าโปรไฟล์`}
        >
          {user?.initials ?? 'นศ'}
        </Link>
      </nav>
      <div className="page-col">
        {/* keyed so every page change replays the enter animation */}
        <div key={pathname} className="page-enter">
          <Outlet />
        </div>
      </div>
      <Tour />
    </div>
  );
}
