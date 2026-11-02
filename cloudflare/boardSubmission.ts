import { PINOUT, RAILS, type Board, type Part } from "../src/lib/z80/board";

/** Validate persisted hand-ins before the instructor opens them in the simulator. */
export function validSubmissionBoard(value: unknown): value is Board {
  if (!value || typeof value !== "object") return false;
  const b = value as Board;
  if (
    !Array.isArray(b.parts) ||
    !Array.isArray(b.wires) ||
    b.parts.length > 1000 ||
    b.wires.length > 10000
  )
    return false;
  const parts = new Map<string, Part>();
  for (const p of b.parts) {
    if (
      !p ||
      typeof p.id !== "string" ||
      !p.id ||
      p.id.length > 100 ||
      parts.has(p.id) ||
      !Object.hasOwn(PINOUT, p.type)
    )
      return false;
    if (
      ![p.x, p.y, p.rot].every(Number.isFinite) ||
      Math.abs(p.x) > 100000 ||
      Math.abs(p.y) > 100000 ||
      !Number.isInteger(p.rot) ||
      p.rot < 0 ||
      p.rot > 3
    )
      return false;
    if (
      (p.val !== undefined && (!Number.isFinite(p.val) || p.val < 0)) ||
      (p.pos !== undefined &&
        (!Number.isFinite(p.pos) || p.pos < 0 || p.pos > 1)) ||
      (p.model !== undefined && typeof p.model !== "string")
    )
      return false;
    parts.set(p.id, p);
  }
  const endpoint = (r: unknown) => {
    if (typeof r !== "string") return false;
    if (Object.hasOwn(RAILS, r)) return true;
    const split = r.lastIndexOf("."),
      p = parts.get(r.slice(0, split)),
      pin = Number(r.slice(split + 1));
    return split > 0 && !!p && PINOUT[p.type].some((def) => def.n === pin);
  };
  return b.wires.every((w) => w && endpoint(w.a) && endpoint(w.b));
}
