import { useMemo, useState } from 'react';
import { assemble, ISA_PROFILE, Simulator, type StepTrace } from '@lab/mips-core';
import { REG_NAMES, type Reg } from '@lab/contracts';
import { CodeEditor } from '../../ui/CodeEditor';

const example = `# ผลบวก 1 ถึง 5
li $t0, 1
li $t1, 5
li $v0, 0
loop:
  addu $v0, $v0, $t0
  addiu $t0, $t0, 1
  ble $t0, $t1, loop`;
const hex = (n: number) => `0x${(n >>> 0).toString(16).padStart(8, '0').toUpperCase()}`;
const groups = [
  { title: 'ชั่วคราว · $t', names: [...REG_NAMES.slice(8, 16), ...REG_NAMES.slice(24, 26)] },
  { title: 'เก็บค่าข้ามฟังก์ชัน · $s', names: REG_NAMES.slice(16, 24) },
  { title: 'อาร์กิวเมนต์ · ค่าคืน', names: [...REG_NAMES.slice(4, 8), ...REG_NAMES.slice(2, 4)] },
  { title: 'พิเศษ', names: [REG_NAMES[0], REG_NAMES[1], ...REG_NAMES.slice(26, 32)] },
];
const stageText: Record<string, string> = { IF: 'ดึงคำสั่งจากหน่วยความจำ', ID: 'อ่าน register และแยกคำสั่ง', EX: 'คำนวณใน ALU', MEM: 'อ่านหรือเขียนหน่วยความจำ', WB: 'เขียนค่ากลับลง register' };

export function SimulatorPage() {
  const initial = new URLSearchParams(location.search).get('src') || example;
  const [source, setSource] = useState(initial);
  const [machine, setMachine] = useState<Simulator | null>(null);
  const [trace, setTrace] = useState<StepTrace | null>(null);
  const [history, setHistory] = useState<StepTrace[]>([]);
  const [tab, setTab] = useState<'step' | 'registers' | 'datapath' | 'history'>('step');
  const [format, setFormat] = useState<'HEX' | 'DEC'>('DEC');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [, update] = useState(0);
  const preview = useMemo(() => { try { return assemble(source); } catch { return null; } }, [source]);
  const load = () => {
    try { const sim = new Simulator(assemble(source)); setMachine(sim); setTrace(null); setHistory([]); setError(''); update(n => n + 1); return sim; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
  };
  const step = () => {
    const sim = machine || load(); if (!sim) return;
    try { const next = sim.step(); if (next) { setTrace(next); setHistory(old => [...old, next]); } update(n => n + 1); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const run = () => {
    const sim = machine || load(); if (!sim) return;
    try { const traces = sim.run(); setTrace(traces.at(-1) ?? trace); setHistory(old => [...old, ...traces]); update(n => n + 1); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); update(n => n + 1); }
  };
  const back = () => {
    if (!machine?.back()) return;
    const previous = history.slice(0, -1); setHistory(previous); setTrace(previous.at(-1) ?? null); update(n => n + 1); setError('');
  };
  const current = machine?.current;
  const changed = new Map(trace?.changed.map(c => [c.reg, c]) ?? []);
  const display = (n: number) => format === 'HEX' ? hex(n) : String(n);
  const regValue = (name: Reg) => machine ? machine.getRegister(name) : name === '$gp' ? ISA_PROFILE.gp : name === '$sp' ? ISA_PROFILE.sp : 0;
  const instructions = preview?.instructions ?? [];
  return <>
    <header className="top sim-top">
      <h1>จำลองการรัน</h1><span className="program-chip mono">MIPS32 · PC {hex(machine?.pc ?? ISA_PROFILE.textBase)}</span>
      <span className="step-count">ขั้นที่ <b className="mono">{machine?.steps ?? 0}</b></span>
      <button className="btn icon-only" aria-label="เริ่มใหม่" onClick={load}>↻</button>
      <button className="btn" onClick={back} disabled={!machine?.canUndo}>◀ ย้อนกลับ</button>
      <button className="btn accent" onClick={step} disabled={machine?.halted}>ถัดไป ▶</button>
      <button className="btn" onClick={run} disabled={machine?.halted}>⏩ รันจนจบ</button>
    </header>
    <main className="wrap sim-wrap">
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="sim-panels">
        <section className="panel program-panel" aria-label="โปรแกรม">
          <div className="ph"><span>โปรแกรม</span><button className="mini-btn" onClick={() => setEditing(v => !v)}>{editing ? 'ปิดตัวแก้ไข' : 'แก้โค้ด'}</button></div>
          {editing && <div className="sim-editor"><CodeEditor value={source} onChange={v => { setSource(v); setMachine(null); setTrace(null); setHistory([]); }} height={250}/><div className="editor-actions"><button className="btn accent" onClick={() => { if (load()) setEditing(false); }}>โหลดโปรแกรม</button></div></div>}
          <div className="program-lines">
            {instructions.map((inst, i) => <div key={`${inst.address}-${i}`} className={`program-line ${current?.address === inst.address ? 'next' : ''} ${trace?.instruction.address === inst.address ? 'last' : ''}`}>
              <span className="pc-arrow">{current?.address === inst.address ? '▶' : ''}</span><span className="address mono">{hex(inst.address)}</span><code><b>{inst.op}</b> {inst.args.join(', ')}</code>{current?.address === inst.address && <span className="line-tag">ถัดไป</span>}{trace?.instruction.address === inst.address && current?.address !== inst.address && <span className="line-tag">เพิ่งรัน</span>}
            </div>)}
            {!preview && <div className="empty-output">ตรวจ syntax ในตัวแก้ไขโค้ด</div>}
          </div>
          <div className="panel-note">{trace ? <>เพิ่งรัน <span className="inline-chip mono">{trace.instruction.op} {trace.instruction.args.join(', ')}</span> · PC {hex(trace.pcBefore)} → {hex(trace.pcAfter)}</> : 'กด “ถัดไป” เพื่อเริ่มรันทีละคำสั่ง'}</div>
        </section>
        <section className="panel detail-panel" aria-label="รายละเอียดการรัน">
          <div className="detail-tabs" role="tablist" aria-label="มุมมอง">
            <button role="tab" aria-selected={tab === 'step'} className={tab === 'step' ? 'active' : ''} onClick={() => setTab('step')}>ขั้นนี้</button>
            <button role="tab" aria-selected={tab === 'registers'} className={tab === 'registers' ? 'active' : ''} onClick={() => setTab('registers')}>Registers (32)</button>
            <button role="tab" aria-selected={tab === 'datapath'} className={tab === 'datapath' ? 'active' : ''} onClick={() => setTab('datapath')}>Datapath</button>
            <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>ประวัติ</button>
            {tab === 'registers' && <div className="number-format" role="group" aria-label="รูปแบบตัวเลข"><button className={format === 'HEX' ? 'active' : ''} onClick={() => setFormat('HEX')}>HEX</button><button className={format === 'DEC' ? 'active' : ''} onClick={() => setFormat('DEC')}>DEC</button></div>}
          </div>
          {tab === 'step' && <div className="detail-content">
            <div className="step-summary"><span className="subtle">{trace ? `คำสั่งที่เพิ่งรัน · ${hex(trace.pcBefore)}` : 'รอคำสั่งแรก'}</span><strong className="mono">{trace ? `${trace.instruction.op} ${trace.instruction.args.join(', ')}` : 'เริ่มรันโปรแกรม'}</strong><p>{trace ? `รัน ${trace.instruction.op} แล้ว PC ไปที่ ${hex(trace.pcAfter)}` : 'กด “ถัดไป” เพื่อดู register, หน่วยความจำ และ 5 ขั้นของฮาร์ดแวร์'}</p></div>
            <div><h2>ค่าที่เปลี่ยน</h2><div className="change-list">{trace?.changed.map(c => <div key={c.reg}><b className="mono">{c.reg}</b><span className="mono">{display(c.before)} → <strong>{display(c.after)}</strong></span></div>)}{trace && <div><b className="mono">PC</b><span className="mono">{hex(trace.pcBefore)} → <strong>{hex(trace.pcAfter)}</strong></span></div>}{!trace && <p className="subtle">ยังไม่มีค่าเปลี่ยน</p>}</div></div>
            <div><h2>ในฮาร์ดแวร์</h2><div className="stage-cards">{['IF','ID','EX','MEM','WB'].map(name => <div key={name} className={name === 'WB' && trace?.changed.length ? 'emphasis' : ''}><b className="mono">{name}</b><span>{stageText[name]}</span></div>)}</div></div>
          </div>}
          {tab === 'registers' && <div className="detail-content registers-content">
            <div className="special-values"><div className="emphasis"><b className="mono">PC</b><strong className="mono">{format === 'HEX' ? hex(machine?.pc ?? ISA_PROFILE.textBase) : (machine?.pc ?? ISA_PROFILE.textBase)}</strong><small>{trace ? `เดิม ${hex(trace.pcBefore)}` : 'ตำแหน่งคำสั่งถัดไป'}</small></div><div><b className="mono">HI</b><strong className="mono">{display(machine?.hi ?? 0)}</strong><small>ใช้กับ mult / div</small></div><div><b className="mono">LO</b><strong className="mono">{display(machine?.lo ?? 0)}</strong><small>ใช้กับ mult / div</small></div></div>
            <div className="register-groups">{groups.map(group => <div className="reg-group" key={group.title}><span className="group-heading">{group.title}</span>{group.names.map(name => { const change = changed.get(name); return <div key={name} className={`reg-row ${change ? 'changed' : ''}`}><b className="mono">{name}</b><span className="mono">{change && <small>{display(change.before)} → </small>}{display(regValue(name))}</span></div>; })}</div>)}</div>
          </div>}
          {tab === 'datapath' && <div className="detail-content"><h2>5 stages ของคำสั่งล่าสุด</h2><div className="datapath-list">{(trace?.stages ?? ['IF','ID','EX','MEM','WB'].map(name => ({ name, detail: stageText[name] }))).map((s, i) => <div key={s.name}><span className="mono">0{i + 1}</span><b className="mono">{s.name}</b><p>{s.detail}</p></div>)}</div>{trace?.memory.length ? <div><h2>หน่วยความจำที่เปลี่ยน</h2><div className="memory-changes">{trace.memory.map(m => <div key={m.address}><span className="mono">{hex(m.address)}</span><span>{m.before} → <b>{m.after}</b></span></div>)}</div></div> : null}</div>}
          {tab === 'history' && <div className="detail-content"><h2>ประวัติการรัน</h2><div className="history-list">{history.map((h, i) => <div key={i}><span className="mono">{String(i + 1).padStart(2, '0')}</span><span className="mono">{hex(h.pcBefore)}</span><b className="mono">{h.instruction.op} {h.instruction.args.join(', ')}</b></div>)}{!history.length && <p className="subtle">ยังไม่มีคำสั่งที่รัน</p>}</div></div>}
        </section>
      </div>
    </main>
  </>;
}
