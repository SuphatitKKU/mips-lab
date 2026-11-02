import { describe, expect, it } from "vitest";
import { csvText, sortRows } from "./dataTableModel";
describe("classroom data export and ordering", () => {
  it("sorts scores as numbers and always leaves missing scores last", () => {
    const rows = [{ v: 9 }, { v: null }, { v: 100 }, { v: 20 }, { v: 0 }];
    expect(sortRows(rows, (r) => r.v, true).map((r) => r.v)).toEqual([
      100,
      20,
      9,
      0,
      null,
    ]);
    expect(sortRows(rows, (r) => r.v, false).map((r) => r.v)).toEqual([
      0,
      9,
      20,
      100,
      null,
    ]);
    expect(rows.map((r) => r.v)).toEqual([9, null, 100, 20, 0]);
  });
  it("orders student IDs naturally, including numeric sections", () => {
    expect(sortRows(["SEC 10", "SEC 2", "SEC 1"], (r) => r, false)).toEqual([
      "SEC 1",
      "SEC 2",
      "SEC 10",
    ]);
  });
  it("exports Thai, quotes, line breaks and neutralizes spreadsheet formulas", () => {
    const csv = csvText([
      ["ชื่อ", "คะแนน"],
      ['กานต์, "แก้ว"\nชั้นปี 2', 35],
      ['  =HYPERLINK("evil")', 0],
      ["@SUM(A1)", null],
      ["-cmd", 5],
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"กานต์, ""แก้ว""\nชั้นปี 2","35"');
    expect(csv).toContain('"\'  =HYPERLINK(""evil"")","0"');
    expect(csv).toContain('"\'@SUM(A1)",""');
    expect(csv).toContain('"\'-cmd","5"');
  });
});
