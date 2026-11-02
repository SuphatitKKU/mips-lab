import { elemOf, isArray, sizeOf, type Param, type Type } from "./parse";
/** Arrays supplied by the UI/grader are flat, in row-major order for matrices. */
export function argumentArrayTypes(
  params: Param[],
  args: (number | number[] | null)[],
): Type[] {
  return args.flatMap((value, i) => {
    if (!Array.isArray(value)) return [];
    let t = params[i] ? elemOf(params[i].type) : ("int" as Type);
    while (isArray(t)) t = t.elem;
    return [t === "void" ? "int" : t];
  });
}
export const argumentArrayWidths = (
  params: Param[],
  args: (number | number[] | null)[],
) => argumentArrayTypes(params, args).map((t) => sizeOf(t));
export function readArrayValue(
  cpu: { readByte: (a: number) => number; readWord: (a: number) => number },
  at: number,
  t: Type = "int",
) {
  if (sizeOf(t) !== 1) return cpu.readWord(at);
  const v = cpu.readByte(at);
  return t === "char" ? (v << 24) >> 24 : v;
}
