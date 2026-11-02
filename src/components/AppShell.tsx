import { ClassGate } from './ClassGate';
import { useEffect } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import { Icon, ICON } from './Icon';
import { TOUR_EVENT } from './Tour';
import { BrandLogo } from './BrandLogo';

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
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  if (!loggedIn) return <Navigate to="/login" replace state={{ from: pathname + search }} />;

  if (user?.needsClass) return <ClassGate />;

  return (
    <div className="app">
      <header className="workspace-bar">
        <Link to="/" className="workspace-brand" aria-label="MIPS Lab หน้าแรก"><BrandLogo /></Link>
        <span className="workspace-label">ห้องทดลองสถาปัตยกรรมคอมพิวเตอร์</span>
        <Link to="/code" className="workspace-action"><Icon d={ICON.convert} size={17} /><span>เปิดพื้นที่เขียนโค้ด</span></Link>
        <Link to="/settings" className="workspace-profile" aria-label="ตั้งค่าโปรไฟล์">{user?.initials ?? 'นศ'}</Link>
      </header>
      <nav aria-label="เมนูหลัก" className="rail">
        {(isTeacher ? [...NAV, ...TEACHER_NAV] : NAV).map(([path, icon, label]) => {
          const active = isActive(path, pathname);
          return (
            <Link
              key={path}
              to={path}
              aria-label={label}
              title={label}
              aria-current={active ? 'page' : undefined}
              className={`rail-item${active ? ' active' : ''}`}
            >
              <Icon d={ICON[icon]} size={22} />
            </Link>
          );
        })}
        <button className="rail-help" data-tour="help" aria-label="แนะนำหน้านี้" title="แนะนำหน้านี้" onClick={() => window.dispatchEvent(new Event(TOUR_EVENT))}>
          <Icon d={ICON.info} size={20} />
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
    </div>
  );
}
