// Live updates for the teacher page over WebSocket (/api/ws).
// The socket only carries a "something changed" nudge; the page then re-fetches
// /api/teacher/users itself, so access rules stay in one place (the REST route).

import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import * as store from './db';

const PATH = '/api/ws';
const teachers = new Set<WebSocket>();

/** Attaches the WebSocket endpoint to the HTTP server. Browsers can't set headers on a socket, so the session token comes as ?token=. */
export function attachLive(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) return socket.destroy();
    const user = store.userForToken(url.searchParams.get('token') ?? '');
    if (!user || user.role !== 'teacher') {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      teachers.add(ws);
      ws.on('close', () => teachers.delete(ws));
      ws.on('error', () => teachers.delete(ws));
      ws.send(JSON.stringify({ type: 'hello' }));
    });
  });

  // ping every 25 s so proxies keep the socket open and dead ones get dropped
  const alive = new WeakSet<WebSocket>();
  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
  });
  setInterval(() => {
    for (const ws of teachers) {
      if (!alive.has(ws)) {
        ws.terminate();
        teachers.delete(ws);
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 25_000).unref();
}

let timer: NodeJS.Timeout | null = null;

/** Tells every open teacher page to refresh. Bursts (a whole class submitting) collapse into one nudge per 300 ms. */
export function notifyChanged() {
  if (timer || !teachers.size) return;
  timer = setTimeout(() => {
    timer = null;
    const msg = JSON.stringify({ type: 'changed' });
    for (const ws of teachers) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }, 300);
}
