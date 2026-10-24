import { useEffect, useMemo, useRef, useState } from 'react';
import { assemble, compileC, fields, type Instruction } from '@lab/mips-core';
import { CodeEditor } from '../../ui/CodeEditor';

const exampleC = `int main() {
  int s = 0;
  for (int i = 1; i <= 5; i++) {
    s = s + i;
  }
  return s;
}`;
const exampleAsm = `li $t0, 1
li $t1, 5
li $v0, 0
loop:
  addu $v0, $v0, $t0
  addiu $t0, $t0, 1
  ble $t0, $t1, loop`;
const initialCompilation = compileC(exampleC);
const initiallyMapped = initialCompilation.mapping.find(m => m.cLine === 4) ?? initialCompilation.mapping[0];
const initialSelection = Math.max(0, assemble(initialCompilation.asm).instructions.findIndex(i => initiallyMapped?.asmLines.includes(i.line)));
type Mode = 'c' | 'reverse';

function approximateC(source: string) {
  return assemble(source).instructions.map(inst => {
    const [a, b, c] = inst.args;
    switch (inst.op) {
      case 'add': case 'addu': case 'addi': case 'addiu': return `${a} = ${b} + ${c};`;
      case 'sub': case 'subu': return `${a} = ${b} - ${c};`;
      case 'and': case 'andi': return `${a} = ${b} & ${c};`;
      case 'or': case 'ori': return `${a} = ${b} | ${c};`;
      case 'slt': case 'slti': return `${a} = (${b} < ${c});`;
      case 'lw': return `${a} = MEM[${b}];`;
      case 'sw': return `MEM[${b}] = ${a};`;
      case 'beq': return `if (${a} == ${b}) goto ${c};`;
      case 'bne': return `if (${a} != ${b}) goto ${c};`;
      case 'j': return `goto ${a};`;
      default: return `/* ${inst.op} ${inst.args.join(', ')} */`;
    }
  }).join('\n');
}

function explain(inst: Instruction) {
  const [a, b, c] = inst.args;
  switch (inst.op) {
    case 'add': case 'addu': return `บวกค่าใน ${b} กับ ${c} แล้วเก็บผลไว้ที่ ${a}`;
    case 'addi': case 'addiu': return `บวกค่าใน ${b} กับ ${c} แล้วเก็บผลไว้ที่ ${a}`;
    case 'sub': case 'subu': return `ลบ ${c} ออกจาก ${b} แล้วเก็บผลไว้ที่ ${a}`;
    case 'lw': return `อ่านข้อมูล 4 ไบต์จาก ${b} แล้วเก็บไว้ที่ ${a}`;
    case 'sw': return `เขียนค่า ${a} ลงหน่วยความจำที่ ${b}`;
    case 'slt': return `เปรียบเทียบ ${b} < ${c} แล้วเก็บ 1 หรือ 0 ไว้ที่ ${a}`;
    case 'beq': return `ถ้า ${a} เท่ากับ ${b} ให้ข้ามไปที่ ${c}`;
    case 'bne': return `ถ้า ${a} ไม่เท่ากับ ${b} ให้ข้ามไปที่ ${c}`;
    case 'j': return `กระโดดไปที่ ${a}`;
    default: return `คำสั่ง ${inst.op} ใช้ operand ${inst.args.join(', ') || 'ไม่มี'}`;
  }
}

export function Converter() {
  const [mode, setMode] = useState<Mode>('c');
  const [c, setC] = useState(exampleC);
  const [asm, setAsm] = useState(exampleAsm);
  const [result, setResult] = useState(initialCompilation.asm);
  const [mapping, setMapping] = useState<{ cLine: number; asmLines: number[] }[]>(initialCompilation.mapping);
  const [selectedCLine, setSelectedCLine] = useState(initiallyMapped?.cLine ?? 0);
  const [selected, setSelected] = useState(initialSelection);
  const [showMachineCode, setShowMachineCode] = useState(true);
  const [error, setError] = useState('');
  const assemblyListRef = useRef<HTMLDivElement>(null);
  const program = useMemo(() => { try { return assemble(mode === 'c' ? result : asm); } catch { return null; } }, [mode, result, asm]);
  useEffect(() => {
    const list = assemblyListRef.current;
    const row = list?.querySelector<HTMLElement>('.assembly-row.selected');
    if (list && row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 2;
  }, [selected, result, mode]);
  const sourceToRun = mode === 'c' ? result : asm;
  const chosen = program?.instructions[selected];
  const mapped = mapping.find(m => m.cLine === selectedCLine)?.asmLines ?? [];
  const convert = () => {
    try {
      if (mode === 'c') {
        const out = compileC(c);
        setResult(out.asm); setMapping(out.mapping);
        const preferred = out.mapping.find(m => m.cLine === 4) ?? out.mapping[0];
        setSelectedCLine(preferred?.cLine ?? 0);
        const p = assemble(out.asm); setSelected(Math.max(0, p.instructions.findIndex(i => preferred?.asmLines.includes(i.line))));
      } else { assemble(asm); setResult(approximateC(asm)); setMapping([]); setSelectedCLine(0); setSelected(0); }
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setResult(''); setMapping([]); }
  };
  const chooseCLine = (line: number) => {
    setSelectedCLine(line);
    const asmLines = mapping.find(m => m.cLine === line)?.asmLines ?? [];
    const index = program?.instructions.findIndex(i => asmLines.includes(i.line)) ?? -1;
    if (index >= 0) setSelected(index);
  };
  const format = chosen ? fields(chosen.word) : null;
  const bitParts = format?.format === 'R' ? [['op', format.binary.slice(0, 6)], ['rs', format.binary.slice(6, 11)], ['rt', format.binary.slice(11, 16)], ['rd', format.binary.slice(16, 21)], ['shamt', format.binary.slice(21, 26)], ['funct', format.binary.slice(26)]] :
    format?.format === 'I' ? [['op', format.binary.slice(0, 6)], ['rs', format.binary.slice(6, 11)], ['rt', format.binary.slice(11, 16)], ['immediate', format.binary.slice(16)]] :
    format ? [['op', format.binary.slice(0, 6)], ['address', format.binary.slice(6)]] : [];
  return <>
    <header className="top converter-top">
      <h1>แปลงโค้ด</h1>
      <div className="direction" role="group" aria-label="ทิศทางการแปลง">
        <button className={mode === 'c' ? 'on' : ''} aria-pressed={mode === 'c'} onClick={() => { setMode('c'); setResult(''); setError(''); }}>C → MIPS</button>
        <button className={mode === 'reverse' ? 'on' : ''} aria-pressed={mode === 'reverse'} onClick={() => { setMode('reverse'); setResult(''); setError(''); }}>MIPS → C</button>
      </div>
      <label className="machine-toggle"><input type="checkbox" role="switch" checked={showMachineCode} onChange={e => setShowMachineCode(e.target.checked)}/> แสดง machine code</label>
      <button className="btn accent" disabled={!sourceToRun} onClick={() => { location.href = `/simulate?src=${encodeURIComponent(sourceToRun)}`; }}><span aria-hidden="true">▶</span> รันทีละขั้น</button>
    </header>
    <main className="wrap converter-wrap">
      <div className="converter-panels">
        <section className="panel editor-panel" aria-label={mode === 'c' ? 'โค้ด C' : 'MIPS assembly'}>
          <div className="ph"><span>{mode === 'c' ? 'C' : 'MIPS'} <span className="chip">{mode === 'c' ? 'sum.c' : 'source.asm'}</span></span><button className="mini-btn" onClick={convert}>แปลงโค้ด →</button></div>
          <CodeEditor value={mode === 'c' ? c : asm} onChange={mode === 'c' ? v => { setC(v); setResult(''); setMapping([]); } : v => { setAsm(v); setResult(''); }} onLineClick={mode === 'c' ? chooseCLine : undefined} selectedLine={mode === 'c' ? selectedCLine : undefined} language={mode === 'c' ? 'c' : 'mips'} height={480}/>
          <div className="panel-note">{mode === 'c' ? 'คลิกบรรทัด C เพื่อดูว่ากลายเป็นคำสั่ง MIPS อะไร' : 'แก้ Assembly แล้วกดแปลงโค้ดเพื่อดูความหมายและ machine code'}</div>
        </section>
        <section className="panel output-panel" aria-label={mode === 'c' ? 'MIPS assembly' : 'C-like output'}>
          <div className="ph"><span>{mode === 'c' ? 'MIPS' : 'C (โดยประมาณ)'}</span><span className="subtle">{mode === 'c' && selectedCLine ? `C บรรทัด ${selectedCLine} → ${mapped.length} คำสั่ง` : result ? `${program?.instructions.length ?? 0} คำสั่ง` : 'รอการแปลง'}</span></div>
          {mode === 'reverse' ? <CodeEditor value={result || '// กดแปลงโค้ดเพื่ออ่าน Assembly'} language="c" readOnly height={480}/> :
            <div className="assembly-list" ref={assemblyListRef}>
              {program?.instructions.map((inst, i) => <button key={`${inst.address}-${i}`} className={`assembly-row ${selected === i ? 'selected' : ''} ${mapped.includes(inst.line) ? 'mapped' : ''}`} onClick={() => setSelected(i)}>
                <span className="g">{i + 1}</span><span className="asm-text"><b>{inst.op}</b> {inst.args.join(', ')}</span>{showMachineCode && <span className="hex">{fields(inst.word).hex.slice(2).toUpperCase()}</span>}
              </button>)}
              {!program?.instructions.length && <div className="empty-output">กดแปลงโค้ดเพื่อสร้างคำสั่ง MIPS</div>}
            </div>}
          <div className="panel-note output-actions"><span>{mode === 'reverse' ? 'แสดงความหมายทีละคำสั่ง ไม่ใช่ C ต้นฉบับ' : `${program?.instructions.length ?? 0} คำสั่ง`}</span><button disabled={!result} onClick={() => navigator.clipboard.writeText(result)}>คัดลอก</button></div>
        </section>
      </div>
      {error && <div className="error-box" role="alert">{error}</div>}
      {chosen && mode === 'c' && <section className="panel selected-panel" aria-label="คำสั่งที่เลือก">
        <div className="selected-description"><span className="subtle">คำสั่งที่เลือก</span><strong className="mono">{chosen.op} {chosen.args.join(', ')}</strong><p>{explain(chosen)}</p><a href={`/simulate?src=${encodeURIComponent(result)}`}>ดูว่าฮาร์ดแวร์ทำอะไรในตัวจำลอง →</a></div>
        <div className="bits"><span className="subtle">เลขฐานสอง 32 บิต · {format?.format}-type</span><div className="bit-cells" style={{ gridTemplateColumns: bitParts.map(x => `${x[1].length}fr`).join(' ') }}>{bitParts.map(([label, bits]) => <div key={label}><b>{bits}</b><span>{label}</span></div>)}</div><span className="mono subtle">= {format?.hex}</span></div>
      </section>}
    </main>
  </>;
}
