import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Icon, ICON } from "./Icon";
import { csvText, sortRows } from "./dataTableModel";
import "./data-table.css";

export interface DataColumn<T> {
  id: string;
  title: string;
  value: (row: T) => string | number | null | undefined;
  cell?: (row: T) => ReactNode;
  exportValue?: (row: T) => string | number | null | undefined;
  numeric?: boolean;
  sortable?: boolean;
  exportable?: boolean;
}
interface Props<T> {
  label: string;
  rows: T[];
  columns: DataColumn<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  searchLabel?: string;
  empty?: string;
  filters?: ReactNode;
  filename?: string;
  extraActions?: (rows: T[]) => ReactNode;
  defaultSort?: { id: string; desc: boolean };
}
export function DataTable<T>({
  label,
  rows,
  columns,
  rowKey,
  loading,
  searchLabel = "ค้นหาในตาราง",
  empty = "ยังไม่มีข้อมูล",
  filters,
  filename,
  defaultSort,
  extraActions,
}: Props<T>) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(defaultSort);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = columns.filter((c) => !hidden.includes(c.id));
  const filtered = useMemo(() => {
    const terms = query
      .trim()
      .toLocaleLowerCase("th")
      .split(/\s+/)
      .filter(Boolean);
    const list = rows.filter((row) => {
      const text = columns
        .map((c) => c.value(row) ?? "")
        .join(" ")
        .toLocaleLowerCase("th");
      return terms.every((t) => text.includes(t));
    });
    const column = columns.find((c) => c.id === sort?.id);
    return column && sort ? sortRows(list, column.value, sort.desc) : list;
  }, [rows, columns, query, sort]);
  const identities = rows.map(rowKey).join("\0");
  useEffect(() => {
    setPage(0);
  }, [identities]);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.min(page, pages - 1);
  // Clamp on filtering, deleting a row, or a refresh shrinking the result set.
  useEffect(() => {
    setPage((p) => Math.min(p, pages - 1));
  }, [pages]);
  const result = filtered.slice(current * size, (current + 1) * size);
  const download = () => {
    const cols = visible.filter((c) => c.exportable !== false);
    const csv = csvText([
      cols.map((c) => c.title),
      ...filtered.map((r) => cols.map((c) => (c.exportValue ?? c.value)(r))),
    ]);
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename ?? "mips-lab.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="data-table"
      aria-label={label}
      aria-busy={loading || undefined}
    >
      <div className="dt-toolbar">
        <label className="dt-search" htmlFor={id}>
          <Icon d={ICON.search} size={17} />
          <input
            id={id}
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <div className="dt-tools">
          {filters}
          {extraActions?.(filtered)}
          <details className="dt-columns">
            <summary>
              คอลัมน์ <span aria-hidden="true">⌄</span>
            </summary>
            <div className="dt-column-menu">
              {columns.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c.id)}
                    disabled={visible.length === 1 && !hidden.includes(c.id)}
                    onChange={() =>
                      setHidden((h) =>
                        h.includes(c.id)
                          ? h.filter((x) => x !== c.id)
                          : [...h, c.id],
                      )
                    }
                  />
                  {c.title}
                </label>
              ))}
            </div>
          </details>
          <button
            type="button"
            className="btn btn-secondary dt-export"
            disabled={loading || !filtered.length}
            onClick={download}
          >
            <Icon d={ICON.download} size={15} />
            ส่งออก CSV
          </button>
        </div>
      </div>
      <div
        className="dt-scroll"
        tabIndex={0}
        role="region"
        aria-label={`เลื่อนตาราง${label}`}
      >
        <table>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {visible.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  data-column={c.id}
                  className={c.numeric ? "dt-numeric" : undefined}
                  aria-sort={
                    sort?.id === c.id
                      ? sort.desc
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  {c.sortable === false ? (
                    c.title
                  ) : (
                    <button
                      type="button"
                      aria-label={`เรียงตาม${c.title}`}
                      onClick={() => {
                        setSort((s) => ({
                          id: c.id,
                          desc: s?.id === c.id ? !s.desc : !!c.numeric,
                        }));
                        setPage(0);
                      }}
                    >
                      {c.title}
                      <span
                        className={
                          sort?.id === c.id ? "dt-sort active" : "dt-sort"
                        }
                        aria-hidden="true"
                      >
                        {sort?.id === c.id ? (
                          <Icon
                            d={sort.desc ? ICON.sortDown : ICON.sortUp}
                            size={13}
                          />
                        ) : (
                          "↕"
                        )}
                      </span>
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length
              ? Array.from({ length: 5 }, (_, n) => (
                  <tr key={n}>
                    {visible.map((c) => (
                      <td key={c.id}>
                        <div className="skeleton dt-skeleton" />
                      </td>
                    ))}
                  </tr>
                ))
              : result.map((row) => (
                  <tr key={rowKey(row)}>
                    {visible.map((c) => (
                      <td
                        key={c.id}
                        data-column={c.id}
                        className={c.numeric ? "dt-numeric" : undefined}
                      >
                        {c.cell ? c.cell(row) : (c.value(row) ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))}
            {!loading && !filtered.length && (
              <tr>
                <td colSpan={visible.length}>
                  <div className="dt-empty">
                    <Icon d={ICON.search} size={28} />
                    <strong>
                      {rows.length ? "ไม่พบข้อมูลที่ตรงกับการค้นหา" : empty}
                    </strong>
                    <span>
                      {rows.length
                        ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง"
                        : "ข้อมูลจะแสดงที่นี่เมื่อมีรายการ"}
                    </span>
                    {query && (
                      <button
                        type="button"
                        className="btn btn-soft"
                        onClick={() => {
                          setQuery("");
                          setPage(0);
                        }}
                      >
                        ล้างการค้นหา
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="dt-footer">
        <span role="status" aria-live="polite">
          {filtered.length
            ? `${current * size + 1}–${Math.min((current + 1) * size, filtered.length)} จาก ${filtered.length.toLocaleString("th-TH")} รายการ`
            : "0 รายการ"}
          {filtered.length !== rows.length && ` (ทั้งหมด ${rows.length})`}
        </span>
        <div className="dt-pagination">
          <label>
            ต่อหน้า{" "}
            <select
              aria-label={`จำนวนรายการต่อหน้า ${label}`}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(0);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="dt-edge"
            aria-label={`หน้าแรก ${label}`}
            disabled={!current}
            onClick={() => setPage(0)}
          >
            «
          </button>
          <button
            type="button"
            aria-label={`หน้าก่อนหน้า ${label}`}
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <Icon d={ICON.chevronLeft} size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            aria-label={`หน้าถัดไป ${label}`}
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <Icon d={ICON.chevronRight} size={16} />
          </button>
          <button
            type="button"
            className="dt-edge"
            aria-label={`หน้าสุดท้าย ${label}`}
            disabled={current >= pages - 1}
            onClick={() => setPage(pages - 1)}
          >
            »
          </button>
        </div>
      </div>
    </section>
  );
}
