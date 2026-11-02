// Thin fetch wrapper for the MIPS Lab API. The session token lives in
// localStorage ("จำฉันไว้") or sessionStorage (this tab only).

import { useCallback, useEffect, useState } from 'react';

const KEY = 'mipslab.token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    msg: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(msg);
  }
}

function storage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return storage('local')?.getItem(KEY) ?? storage('session')?.getItem(KEY) ?? null;
}

export function setToken(token: string | null, remember = true) {
  storage('local')?.removeItem(KEY);
  storage('session')?.removeItem(KEY);
  if (token) storage(remember ? 'local' : 'session')?.setItem(KEY, token);
}

/** Fired when the server rejects the session so the app can return to the login page. */
export const UNAUTHORIZED = 'mipslab:unauthorized';
export const NEEDS_CLASS = 'mipslab:needs-class';

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจว่าเปิด npm run dev อยู่');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 && data.needsClass) window.dispatchEvent(new Event(NEEDS_CLASS));
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED));
    throw new ApiError(res.status, (data as { error?: string }).error ?? `เกิดข้อผิดพลาด (${res.status})`, data);
  }
  return data as T;
}

/** Loads `path` on mount / when it changes. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: ApiError) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, reload, setData };
}
