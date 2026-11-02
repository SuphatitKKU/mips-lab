const collator = new Intl.Collator("th", {
  numeric: true,
  sensitivity: "base",
});
export function sortRows<T>(
  rows: T[],
  value: (r: T) => string | number | null | undefined,
  desc: boolean,
): T[] {
  return [...rows].sort((a, b) => {
    const x = value(a),
      y = value(b);
    // Missing values always sort last, including descending order.
    if (x == null) return y == null ? 0 : 1;
    if (y == null) return -1;
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : collator.compare(String(x), String(y))) * (desc ? -1 : 1)
    );
  });
}
export function csvText(rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s\uFEFF]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
