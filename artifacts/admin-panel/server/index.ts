import express, { Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../");

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ─── State ───────────────────────────────────────────────────────────────────

interface PhaseState {
  running: boolean;
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  finishedAt?: string;
  logs: string[];
  sseClients: Set<Response>;
  proc?: ChildProcess;
}

const phaseStates: Record<string, PhaseState> = {};

function getState(phase: string): PhaseState {
  if (!phaseStates[phase]) {
    phaseStates[phase] = { running: false, logs: [], sseClients: new Set() };
  }
  return phaseStates[phase];
}

function pushLine(state: PhaseState, line: string) {
  state.logs.push(line);
  for (const client of state.sseClients) {
    client.write(`data: ${JSON.stringify(line)}\n\n`);
  }
}

function broadcastDone(state: PhaseState, code: number | null) {
  for (const client of state.sseClients) {
    client.write(`event: done\ndata: ${JSON.stringify({ exitCode: code })}\n\n`);
    client.end();
  }
  state.sseClients.clear();
}

// ─── Script map ──────────────────────────────────────────────────────────────

const SCRIPT_MAP: Record<string, string> = {
  "1": "test:phase1",
  "2": "test:phase2",
  "3": "test:phase3",
  "4": "test:phase4",
  "5": "test:phase5",
};

// ─── POST /api/phases/:phase/run ─────────────────────────────────────────────

app.post("/api/phases/:phase/run", (req: Request, res: Response) => {
  const { phase } = req.params;
  const script = SCRIPT_MAP[phase];
  if (!script) return res.status(404).json({ error: "Unknown phase" });

  const state = getState(phase);
  if (state.running) return res.status(409).json({ error: "Already running" });

  state.running = true;
  state.exitCode = undefined;
  state.startedAt = new Date().toISOString();
  state.finishedAt = undefined;
  state.logs = [];

  const child = spawn("pnpm", ["run", script], {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env },
    shell: true,
  });

  state.proc = child;
  state.pid = child.pid;

  const handleData = (prefix: string) => (data: Buffer) => {
    const text = data.toString();
    text.split("\n").forEach((line) => {
      const trimmed = line.trimEnd();
      if (trimmed) pushLine(state, prefix + trimmed);
    });
  };

  child.stdout.on("data", handleData(""));
  child.stderr.on("data", handleData("[err] "));

  child.on("close", (code) => {
    state.running = false;
    state.exitCode = code;
    state.finishedAt = new Date().toISOString();
    pushLine(state, `\u001b[90m── Phase ${phase} finished (exit ${code}) ──\u001b[0m`);
    broadcastDone(state, code);
  });

  return res.json({ started: true, pid: child.pid, startedAt: state.startedAt });
});

// ─── GET /api/phases/:phase/status ───────────────────────────────────────────

app.get("/api/phases/:phase/status", (req: Request, res: Response) => {
  const state = getState(req.params.phase);
  res.json({
    running: state.running,
    exitCode: state.exitCode ?? null,
    startedAt: state.startedAt ?? null,
    finishedAt: state.finishedAt ?? null,
    logLines: state.logs.length,
  });
});

// ─── GET /api/phases/:phase/logs (SSE) ───────────────────────────────────────

app.get("/api/phases/:phase/logs", (req: Request, res: Response) => {
  const state = getState(req.params.phase);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  for (const line of state.logs) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  if (!state.running && state.exitCode !== undefined) {
    res.write(`event: done\ndata: ${JSON.stringify({ exitCode: state.exitCode })}\n\n`);
    return res.end();
  }

  state.sseClients.add(res);
  req.on("close", () => state.sseClients.delete(res));
});

// ─── DELETE /api/phases/:phase/run (kill) ────────────────────────────────────

app.delete("/api/phases/:phase/run", (req: Request, res: Response) => {
  const state = getState(req.params.phase);
  if (state.proc && state.running) {
    state.proc.kill("SIGTERM");
    return res.json({ killed: true });
  }
  return res.json({ killed: false, reason: "Not running" });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = Number(process.env.RUNNER_PORT ?? 3099);
app.listen(PORT, () => {
  console.log(`[runner] listening on port ${PORT}`);
});
