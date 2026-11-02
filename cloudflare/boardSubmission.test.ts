import { expect, it } from "vitest";
import { validSubmissionBoard } from "./boardSubmission";
it("accepts supported circuits and rejects hand-ins that would break the instructor simulator", () => {
  const board = {
    parts: [{ id: "cpu1", type: "CPU", x: 100, y: 100, rot: 0 }],
    wires: [{ a: "cpu1.11", b: "rail:vt" }],
  };
  expect(validSubmissionBoard(board)).toBe(true);
  expect(validSubmissionBoard({ parts: [], wires: [] })).toBe(true);
  expect(validSubmissionBoard({ ...board, parts: [null] })).toBe(false);
  expect(
    validSubmissionBoard({
      ...board,
      parts: [{ ...board.parts[0], type: "unknown" }],
    }),
  ).toBe(false);
  expect(
    validSubmissionBoard({ ...board, parts: [{ ...board.parts[0], x: NaN }] }),
  ).toBe(false);
  expect(
    validSubmissionBoard({ ...board, parts: [...board.parts, ...board.parts] }),
  ).toBe(false);
  expect(
    validSubmissionBoard({
      ...board,
      wires: [{ a: "cpu1.9999", b: "rail:vt" }],
    }),
  ).toBe(false);
  expect(
    validSubmissionBoard({ ...board, wires: [{ a: {}, b: "rail:vt" }] }),
  ).toBe(false);
  expect(
    validSubmissionBoard({
      ...board,
      wires: [{ a: "missing.1", b: "rail:vt" }],
    }),
  ).toBe(false);
});
