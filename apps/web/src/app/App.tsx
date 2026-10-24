import { Converter } from '../features/converter/Converter';
import { SimulatorPage } from '../features/simulator/SimulatorPage';

function Icon({ kind }: { kind: 'chip' | 'convert' | 'play' }) {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'chip' ? <><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/></> :
      kind === 'convert' ? <><path d="M3 7.5h14M13.5 4l3.5 3.5-3.5 3.5M19 14.5H5M8.5 11L5 14.5 8.5 18"/></> :
      <><path d="M5 4.5v13l9.5-6.5zM17.5 4.5v13"/></>}
  </svg>;
}

export function App() {
  const simulate = location.pathname === '/simulate';
  return <div className="shell">
    <nav className="rail" aria-label="เมนูหลัก">
      <a className="rail-brand" href="/convert" aria-label="MIPS Lab"><Icon kind="chip" /></a>
      <a className={`ri ${!simulate ? 'active' : ''}`} href="/convert" aria-current={!simulate ? 'page' : undefined}><Icon kind="convert"/>แปลงโค้ด</a>
      <a className={`ri ${simulate ? 'active' : ''}`} href="/simulate" aria-current={simulate ? 'page' : undefined}><Icon kind="play"/>จำลอง</a>
    </nav>
    <div className="workarea">{simulate ? <SimulatorPage /> : <Converter />}</div>
  </div>;
}
