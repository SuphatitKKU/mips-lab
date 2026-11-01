import { Link, useLocation } from 'react-router-dom';
import { Icon, ICON } from '../components/Icon';
import { PageHeader } from '../components/ui';

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <>
      <PageHeader title="ไม่พบหน้านี้" />
      <main className="main">
        <section className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
          <span style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--soft)', color: 'var(--body-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon d={ICON.search} size={26} />
          </span>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.75 }}>
            ไม่มีหน้า <code className="inline-code">{pathname}</code> — ลิงก์อาจพิมพ์ผิดหรือหน้านี้ถูกย้ายไปแล้ว
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/" className="btn btn-primary">
              กลับหน้าแรก
            </Link>
            <Link to="/problems" className="btn btn-secondary">
              ไปที่โจทย์ฝึก
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
