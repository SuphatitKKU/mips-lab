// A Z80 wired up the way the breadboard says: memory reads go to whichever
// chip the address decode selects (ROM image, RAM, or a floating bus = FFh),
// OUT reaches the latches clocked by that port's decoder output, and IN reads
// the logic levels on the enabled buffer's inputs. An ADC0804 starts a
// conversion on OUT to its port, pulls /INTR low when done, and IN reads it.
// An 8251A receives the bytes an RFID module sends at 9600 baud, in CPU time:
// a CPU too slow to read each byte before the next lands gets an overrun.

import { BAUD, closedSwitches, DEFAULT_ENV, matches, PINOUT, probe, ref, rfidFrame, VCC, type Analysis, type Board, type ChipPins, type Env, type Level } from './board';
import { Z80, type Z80Program } from './z80';

export interface Wiring {
  board: Board;
  an: Analysis;
  pressed: ReadonlySet<string>;
  env?: Env;
  /** CPU clock in Hz, which sets how many T-states a serial byte takes */
  hz?: number;
}

export interface AdcState {
  /** last finished conversion, 0–255 */
  value: number;
  /** /INTR: 0 = a result is waiting */
  intr: 0 | 1;
  /** result of the conversion in progress, ready at `doneAt` (T-states) */
  pending: number | null;
  doneAt: number;
  /** VIN+ and full-scale volts of the last conversion started */
  vin: number;
  vref: number;
}

export interface UsartState {
  /** mode instruction; null until the first control write after reset */
  mode: number | null;
  command: number;
  /** receive buffer */
  data: number;
  rxrdy: boolean;
  overrun: boolean;
  /** bytes on the wire, landing at `at` (T-states) */
  queue: { at: number; byte: number }[];
  /** bytes the receiver took in, latest last */
  log: number[];
  /** bytes the program sent out on TxD, oldest first (the web terminal shows them) */
  tx: number[];
  /** bytes trimmed off the front of `tx` to keep it short: tx[i] is byte number txDropped + i of the run */
  txDropped: number;
}

/** command bit 2: receiver enabled */
export const RX_ENABLE = 0x04;
/** command bit 0: transmitter enabled */
export const TX_ENABLE = 0x01;
/** fewest T-states between bytes typed into the web terminal, so a polling loop at a slow clock still keeps up */
const TERMINAL_GAP = 400;

export interface Machine {
  cpu: Z80;
  /** value held by each 74HC574, by part id */
  latch: Map<string, number>;
  /** each ADC0804's conversion state, by part id */
  adc: Map<string, AdcState>;
  /** each 8251A's receiver, by part id */
  usart: Map<string, UsartState>;
  /** state of chip output pins (ADC /INTR, USART RxRDY), for drawing the board */
  chips: () => ChipPins;
  /** a card held to RFID module `reader`: its frame goes out on TX; returns the USARTs that hear it */
  tap: (reader: string, uid: string) => string[];
  /** RFID modules still sending, by part id */
  sending: () => Set<string>;
  /** bytes typed into the web terminal, arriving on USART `id`'s RxD one after another */
  send: (id: string, bytes: number[]) => void;
  /** program bytes that fall outside the 8 KB EPROM */
  overflow: number;
  /** /RESET pulse: CPU restarts at 0000h, RAM and latches keep their contents */
  reset: () => void;
}

const ROM_SIZE = 0x2000;
const RAM_SIZE = 0x2000;
/** ADC0804 conversion time in CPU T-states (~100 µs at the clock rates the board runs) */
export const ADC_T = 64;

export function createMachine(prog: Z80Program, wiring: () => Wiring, onOut?: (port: number, v: number, cycles: number) => void): Machine {
  const rom = new Uint8Array(ROM_SIZE).fill(0xff); // erased EPROM reads FFh
  let overflow = 0;
  for (const [a, b] of prog.bytes) {
    if (a < ROM_SIZE) rom[a] = b;
    else overflow++;
  }
  const ram = new Uint8Array(RAM_SIZE);
  const latch = new Map<string, number>();
  const adc = new Map<string, AdcState>();
  const usart = new Map<string, UsartState>();
  const sendingUntil = new Map<string, number>();
  let version = 0; // bumps whenever something a pin level depends on changes, so cached levels are redone

  const adcOf = (id: string) => {
    let st = adc.get(id);
    if (!st) adc.set(id, (st = { value: 0, intr: 1, pending: null, doneAt: 0, vin: 0, vref: VCC }));
    return st;
  };
  const usartOf = (id: string) => {
    let st = usart.get(id);
    if (!st) usart.set(id, (st = { mode: null, command: 0, data: 0, rxrdy: false, overrun: false, queue: [], log: [], tx: [], txDropped: 0 }));
    return st;
  };
  const chips = (): ChipPins => ({
    intr: new Map([...adc].map(([id, st]) => [id, st.intr])),
    rxrdy: new Map([...usart].map(([id, st]) => [id, st.rxrdy])),
  });
  /** catch up with time: conversions finish and pull /INTR low, serial bytes land in the receive buffer */
  const finish = () => {
    for (const st of adc.values())
      if (st.pending != null && m.cpu.cycles >= st.doneAt) {
        st.value = st.pending;
        st.pending = null;
        st.intr = 0;
        version++;
      }
    for (const st of usart.values())
      while (st.queue.length && st.queue[0].at <= m.cpu.cycles) {
        const { byte } = st.queue.shift()!;
        if (st.mode == null || !(st.command & RX_ENABLE)) continue; // receiver off: the byte is lost
        if (st.rxrdy) st.overrun = true; // the previous byte was never read
        st.data = byte;
        st.rxrdy = true;
        st.log = [...st.log.slice(-31), byte];
        version++;
      }
  };

  // IN can run thousands of times per frame; keep the level solver until the wiring, switches, room or outputs change
  let cache: { board: Board; pressed: ReadonlySet<string>; env: Env; version: number; at: (r: string) => Level } | null = null;
  const live = (w: Wiring) => {
    const env = w.env ?? DEFAULT_ENV;
    return probe(w.board, w.an, latch, closedSwitches(w.board, w.pressed, env), env, chips());
  };
  const levels = (w: Wiring) => {
    const env = w.env ?? DEFAULT_ENV;
    if (cache && cache.board === w.board && cache.pressed === w.pressed && cache.env === env && cache.version === version) return cache.at;
    const at = live(w).lv.at;
    cache = { board: w.board, pressed: w.pressed, env, version, at };
    return at;
  };

  const make = () =>
    new Z80(undefined, {
      read: (a) => {
        const { an } = wiring();
        if (an.rom && matches(an.rom.at, a)) return rom[a & (ROM_SIZE - 1)];
        if (an.ram && matches(an.ram.at, a)) return ram[a & (RAM_SIZE - 1)];
        return 0xff;
      },
      write: (a, v) => {
        const { an } = wiring();
        if (an.ram && matches(an.ram.at, a)) ram[a & (RAM_SIZE - 1)] = v;
      },
      out: (port, v, cycles) => {
        const w = wiring();
        for (const l of w.an.latches)
          if (matches(l.port, port)) {
            latch.set(l.id, l.dataMap.reduce((acc, line, k) => (line >= 0 ? acc | (((v >> line) & 1) << k) : acc), 0));
            version++;
          }
        // /WR on an ADC starts a conversion of whatever VIN+ holds right now
        const starting = w.an.adcs.filter((a) => a.wr && matches(a.wr, port));
        if (starting.length) {
          const { lv } = live(w);
          for (const a of starting) {
            const st = adcOf(a.id);
            const half = lv.volts(ref(a.id, 9));
            st.vin = lv.volts(ref(a.id, 6)) ?? 0;
            st.vref = half != null && half > 0.1 ? half * 2 : VCC;
            // codes change half an LSB early, as on the ADC0804, so a reading rounds to the nearest step
            st.pending = Math.max(0, Math.min(255, Math.round((st.vin / st.vref) * 256)));
            st.doneAt = cycles + ADC_T;
            st.intr = 1;
          }
          version++;
        }
        // 8251A: C/D = 1 writes the mode instruction (first after reset), then commands; C/D = 0 sends a byte
        for (const u of w.an.usarts) {
          if (!u.wr || !matches(u.wr, port)) continue;
          finish();
          const st = usartOf(u.id);
          const bus = u.dataMap.reduce((acc, line, k) => (line >= 0 ? acc | (((v >> line) & 1) << k) : acc), 0);
          if (!((port >> u.cd) & 1)) {
            // transmitter on (command bit 0) after a mode was set: the byte goes out on TxD
            if (st.mode != null && st.command & TX_ENABLE) {
              st.tx.push(bus);
              if (st.tx.length > 8000) {
                st.tx.splice(0, 2000);
                st.txDropped += 2000;
              }
              version++;
            }
            continue;
          }
          if (st.mode == null) st.mode = bus;
          else {
            st.command = bus;
            if (bus & 0x10) st.overrun = false; // error reset
            if (bus & 0x40) Object.assign(st, { mode: null, command: 0, rxrdy: false, overrun: false }); // internal reset
          }
          version++;
        }
        onOut?.(port, v, cycles);
      },
      in: (port) => {
        const w = wiring();
        finish();
        const at = levels(w);
        let v = 0xff; // undriven data lines read as 1
        for (const b of w.an.buffers)
          for (let k = 0; k < 8; k++) {
            const g = b.groups[k < 4 ? 0 : 1];
            const line = b.dataMap[k];
            if (!g || line < 0 || !matches(g, port)) continue;
            const input = PINOUT['244'].find((x) => x.bus === 'IN' && x.bit === k)!;
            if (at(ref(b.id, input.n)) === 0) v &= ~(1 << line);
          }
        // 8251A: C/D = 1 reads status (TxRDY, RxRDY, TxEMPTY, overrun), C/D = 0 reads the received byte
        for (const u of w.an.usarts) {
          if (!u.rd || !matches(u.rd, port)) continue;
          const st = usartOf(u.id);
          let byte: number;
          if ((port >> u.cd) & 1) byte = 0x01 | (st.rxrdy ? 0x02 : 0) | 0x04 | (st.overrun ? 0x10 : 0);
          else {
            byte = st.data;
            if (st.rxrdy) {
              st.rxrdy = false;
              version++;
            }
          }
          for (let k = 0; k < 8; k++) {
            const line = u.dataMap[k];
            if (line >= 0) v = (v & ~(1 << line)) | (((byte >> k) & 1) << line);
          }
        }
        // /RD on an ADC puts its last result on the bus and releases /INTR
        for (const a of w.an.adcs) {
          if (!a.rd || !matches(a.rd, port)) continue;
          const st = adcOf(a.id);
          for (let k = 0; k < 8; k++) {
            const line = a.dataMap[k];
            if (line >= 0) v = (v & ~(1 << line)) | (((st.value >> k) & 1) << line);
          }
          if (st.intr === 0) {
            st.intr = 1;
            version++;
          }
        }
        return v;
      },
    });

  const m: Machine = {
    cpu: make(),
    latch,
    adc,
    usart,
    chips: () => {
      finish();
      return chips();
    },
    tap: (reader, uid) => {
      const w = wiring();
      const frame = rfidFrame(uid);
      const byteT = Math.max(1, Math.round(((w.hz ?? 10_000) * 10) / BAUD));
      const start = m.cpu.cycles + byteT;
      const heard = w.an.usarts.filter((u) => u.rfid === reader);
      if (!w.an.live.has(reader)) return [];
      for (const u of heard) usartOf(u.id).queue.push(...frame.map((byte, i) => ({ at: start + i * byteT, byte })));
      sendingUntil.set(reader, start + frame.length * byteT);
      return heard.map((u) => u.id);
    },
    sending: () => new Set([...sendingUntil].filter(([, until]) => m.cpu.cycles < until).map(([id]) => id)),
    send: (id, bytes) => {
      const w = wiring();
      const st = usartOf(id);
      const gap = Math.max(TERMINAL_GAP, Math.round(((w.hz ?? 10_000) * 10) / BAUD));
      const start = Math.max(m.cpu.cycles, st.queue.at(-1)?.at ?? 0) + gap;
      st.queue.push(...bytes.map((byte, i) => ({ at: start + i * gap, byte })));
    },
    overflow,
    reset: () => {
      // time keeps running through a reset: a conversion or serial byte already under way still lands on schedule
      const t = m.cpu.cycles;
      m.cpu = make();
      m.cpu.cycles = t;
    },
  };
  return m;
}
