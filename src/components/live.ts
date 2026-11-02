// (browser-only: lives outside src/lib, which the server also compiles)
// Teacher page live updates: a WebSocket to /api/ws that says "changed" whenever
// students do something. Reconnects on its own with a growing delay.

import { useEffect, useRef, useState } from 'react';
import { getToken } from '../api';

export type LiveStatus = 'connecting' | 'live' | 'offline';

const RETRY_MS = [1000, 2000, 5000, 10000];

/** Calls onChange when the server says data changed (and after every reconnect, to catch up on anything missed). */
export function useLive(enabled: boolean, onChange: () => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let stopped = false;

    const connect = () => {
      const token = getToken();
      if (!token || stopped) return;
      setStatus((s) => (s === 'live' ? 'connecting' : s));
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?token=${encodeURIComponent(token)}`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as { type: string };
        if (msg.type === 'hello') {
          retry = 0;
          setStatus('live');
          if (connectedBefore) cb.current(); // catch up after a drop
          connectedBefore = true;
        } else if (msg.type === 'changed') cb.current();
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        timer = window.setTimeout(connect, RETRY_MS[Math.min(retry++, RETRY_MS.length - 1)]);
      };
    };
    let connectedBefore = false;
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      ws?.close();
    };
  }, [enabled]);

  return status;
}
