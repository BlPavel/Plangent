import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import fs from 'fs';
import { execSync } from 'child_process';

export interface PtySession {
  id: string;
  pty: pty.IPty;
  sockets: Set<WebSocket>;
  buffer: string;
}

const sessions = new Map<string, PtySession>();

function resolveCommand(cmd: string): string {
  if (cmd.startsWith('/')) return cmd;
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    throw new Error(`Команда не найдена: "${cmd}". Убедитесь, что она установлена и доступна в PATH.`);
  }
}

export function createPtySession(id: string, cmd: string, args: string[], cwd: string, env?: Record<string, string>): PtySession {
  if (!fs.existsSync(cwd)) {
    throw new Error(`Рабочая директория не существует: "${cwd}". Проверьте путь к репозиторию в настройках проекта.`);
  }

  const resolvedCmd = resolveCommand(cmd);

  const mergedEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    TERM: 'xterm-256color',
    ...env,
  };

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(resolvedCmd, args, {
      name: 'xterm-256color',
      cols: 220,
      rows: 50,
      cwd,
      env: mergedEnv,
    });
  } catch (err) {
    throw new Error(`Не удалось запустить "${cmd}": ${err instanceof Error ? err.message : String(err)}`);
  }

  const session: PtySession = {
    id,
    pty: ptyProcess,
    sockets: new Set(),
    buffer: '',
  };

  ptyProcess.onData((data: string) => {
    session.buffer += data;
    if (session.buffer.length > 50000) {
      session.buffer = session.buffer.slice(-50000);
    }
    broadcast(session, { type: 'data', data });
  });

  ptyProcess.onExit(({ exitCode }) => {
    broadcast(session, { type: 'exit', exitCode });
    sessions.delete(id);
  });

  sessions.set(id, session);
  return session;
}

export function getPtySession(id: string): PtySession | undefined {
  return sessions.get(id);
}

export function listPtySessions(): string[] {
  return [...sessions.keys()];
}

export function attachSocket(sessionId: string, ws: WebSocket): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  session.sockets.add(ws);

  if (session.buffer) {
    ws.send(JSON.stringify({ type: 'data', data: session.buffer }));
  }

  ws.on('message', (msg: Buffer) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'input') {
        session.pty.write(parsed.data);
      } else if (parsed.type === 'resize') {
        session.pty.resize(parsed.cols, parsed.rows);
      }
    } catch {}
  });

  ws.on('close', () => {
    session.sockets.delete(ws);
  });

  return true;
}

export function killPtySession(id: string): void {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
  }
}

export function resizePty(id: string, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (session) {
    session.pty.resize(cols, rows);
  }
}

function broadcast(session: PtySession, msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const ws of session.sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}
