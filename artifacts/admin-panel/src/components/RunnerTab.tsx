import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, RotateCcw, CheckCircle2, XCircle, Clock,
  Terminal, ChevronDown, ChevronUp, Layers, TrendingUp,
  Dices, Ticket, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus = "idle" | "running" | "pass" | "fail";

interface PhaseStatus {
  running: boolean;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  logLines: number;
}

// ─── Phase definitions ───────────────────────────────────────────────────────

interface PhaseDef {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  timeout: string;
  storageKey: string;
  reportFile: string;
}

const PHASES: PhaseDef[] = [
  {
    id: "1",
    label: "Phase 1 — Setup",
    description: "Creates franchise, offer groups, cost centres and terminals. Writes phase1-report.json.",
    icon: <Layers className="w-4 h-4" />,
    timeout: "3 min",
    storageKey: "phase1_report",
    reportFile: "test-results/phase1-report.json",
  },
  {
    id: "2",
    label: "Phase 2 — Race Payin",
    description: "Logs in to each terminal and places virtual race tickets. Writes phase2-report.json.",
    icon: <Zap className="w-4 h-4" />,
    timeout: "5 min",
    storageKey: "phase2_report",
    reportFile: "test-results/phase2-report.json",
  },
  {
    id: "3",
    label: "Phase 3 — Race Payout",
    description: "Pays out won race tickets via the integration API and records win-tax. Writes phase3-report.json.",
    icon: <TrendingUp className="w-4 h-4" />,
    timeout: "10 min",
    storageKey: "phase3_report",
    reportFile: "test-results/phase3-report.json",
  },
  {
    id: "4",
    label: "Phase 4 — Bingo Payin",
    description: "Places virtual bingo tickets on each terminal. Writes phase4-report.json.",
    icon: <Dices className="w-4 h-4" />,
    timeout: "10 min",
    storageKey: "phase4_report",
    reportFile: "test-results/phase4-report.json",
  },
  {
    id: "5",
    label: "Phase 5 — Bingo Payout",
    description: "Pays out won bingo tickets and records win-tax. Writes phase5-report.json.",
    icon: <Ticket className="w-4 h-4" />,
    timeout: "10 min",
    storageKey: "phase5_report",
    reportFile: "test-results/phase5-report.json",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function elapsed(start: string | null, end: string | null): string {
  if (!start) return "";
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusColor(status: RunStatus) {
  if (status === "running") return "text-yellow-400";
  if (status === "pass")    return "text-primary";
  if (status === "fail")    return "text-destructive";
  return "text-muted-foreground";
}

function StatusBadge({ status }: { status: RunStatus }) {
  if (status === "running") return (
    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />Running
    </Badge>
  );
  if (status === "pass") return (
    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1">
      <CheckCircle2 className="w-3 h-3" />Pass
    </Badge>
  );
  if (status === "fail") return (
    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1">
      <XCircle className="w-3 h-3" />Fail
    </Badge>
  );
  return (
    <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border/50 gap-1">
      <Clock className="w-3 h-3" />Idle
    </Badge>
  );
}

// ─── ANSI stripping (basic) ───────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function lineClass(raw: string): string {
  const s = stripAnsi(raw).toLowerCase();
  if (s.includes("passing") || s.includes("✓") || s.includes("pass"))  return "text-emerald-400";
  if (s.includes("failing") || s.includes("error") || s.includes("✗") || s.includes("[err]")) return "text-red-400";
  if (s.includes("warn") || s.includes("skip"))  return "text-yellow-300";
  if (s.startsWith("──") || s.includes("done"))  return "text-zinc-500";
  return "text-zinc-300";
}

// ─── Per-phase panel ─────────────────────────────────────────────────────────

function PhasePanel({ phase, onReportLoaded }: { phase: PhaseDef; onReportLoaded: (key: string, data: unknown) => void }) {
  const [status, setStatus]         = useState<RunStatus>("idle");
  const [phaseInfo, setPhaseInfo]   = useState<PhaseStatus | null>(null);
  const [logs, setLogs]             = useState<string[]>([]);
  const [logsOpen, setLogsOpen]     = useState(true);
  const [apiError, setApiError]     = useState<string | null>(null);
  const [ticker, setTicker]         = useState(0);

  const sseRef    = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Poll status on mount
  useEffect(() => {
    fetchStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  // Tick for elapsed timer while running
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setTicker(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/phases/${phase.id}/status`);
      if (!r.ok) { setApiError("Runner server unavailable"); return; }
      setApiError(null);
      const data: PhaseStatus = await r.json();
      setPhaseInfo(data);
      if (data.running) {
        setStatus("running");
        connectSSE();
      } else if (data.exitCode === 0) {
        setStatus("pass");
      } else if (data.exitCode !== null) {
        setStatus("fail");
      }
    } catch {
      setApiError("Runner server unavailable — start the dev server to enable phase execution.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource(`/api/phases/${phase.id}/logs`);
    sseRef.current = es;

    es.onmessage = (e) => {
      const line: string = JSON.parse(e.data);
      setLogs(prev => [...prev, line]);
    };

    es.addEventListener("done", (e) => {
      const { exitCode }: { exitCode: number | null } = JSON.parse((e as MessageEvent).data);
      setStatus(exitCode === 0 ? "pass" : "fail");
      setPhaseInfo(prev => prev ? { ...prev, running: false, exitCode } : prev);
      es.close();
      sseRef.current = null;
      // Try to load report from localStorage after a short delay
      setTimeout(() => tryLoadReport(), 1500);
    });

    es.onerror = () => {
      es.close();
      sseRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  const tryLoadReport = useCallback(() => {
    const raw = localStorage.getItem(phase.storageKey);
    if (raw) {
      try { onReportLoaded(phase.storageKey, JSON.parse(raw)); } catch {}
    }
  }, [phase.storageKey, onReportLoaded]);

  const handleRun = async () => {
    setLogs([]);
    setStatus("running");
    setLogsOpen(true);
    setApiError(null);
    try {
      const r = await fetch(`/api/phases/${phase.id}/run`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setApiError(err.error ?? "Failed to start");
        setStatus("idle");
        return;
      }
      const data = await r.json();
      setPhaseInfo(prev => ({
        ...(prev ?? { logLines: 0 }),
        running: true,
        exitCode: null,
        startedAt: data.startedAt,
        finishedAt: null,
      }));
      connectSSE();
    } catch {
      setApiError("Runner server unavailable.");
      setStatus("idle");
    }
  };

  const handleStop = async () => {
    await fetch(`/api/phases/${phase.id}/run`, { method: "DELETE" }).catch(() => {});
    sseRef.current?.close();
    sseRef.current = null;
    setStatus("fail");
    setPhaseInfo(prev => prev ? { ...prev, running: false, exitCode: -1 } : prev);
  };

  const handleClear = () => {
    setLogs([]);
    setStatus("idle");
    setPhaseInfo(null);
  };

  const isRunning = status === "running";
  const isDone    = status === "pass" || status === "fail";
  const elapsedStr = elapsed(phaseInfo?.startedAt ?? null, phaseInfo?.finishedAt ?? null);

  return (
    <motion.div
      key={phase.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header card */}
      <Card className={`border ${isRunning ? "border-yellow-500/30 bg-yellow-500/5" : status === "pass" ? "border-primary/30 bg-primary/5" : status === "fail" ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
        <CardHeader className="p-5 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isRunning ? "bg-yellow-500/15 text-yellow-400" : status === "pass" ? "bg-primary/15 text-primary" : status === "fail" ? "bg-destructive/15 text-destructive" : "bg-muted/50 text-muted-foreground"}`}>
                {phase.icon}
              </div>
              <div>
                <CardTitle className={`text-base ${statusColor(status)}`}>{phase.label}</CardTitle>
                <CardDescription className="mt-0.5">{phase.description}</CardDescription>
              </div>
            </div>
            <StatusBadge status={status} />
          </div>
        </CardHeader>

        <CardContent className="p-5 pt-0">
          <div className="flex items-center gap-3 flex-wrap">
            {!isRunning ? (
              <Button
                size="sm"
                onClick={handleRun}
                className="gap-1.5"
                disabled={!!apiError}
              >
                <Play className="w-3.5 h-3.5" />
                {isDone ? "Re-run" : "Run Phase"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                onClick={handleStop}
                className="gap-1.5"
              >
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            )}

            {isDone && (
              <Button size="sm" variant="ghost" onClick={handleClear} className="gap-1.5 text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}

            <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
              {phaseInfo?.startedAt && (
                <span className="font-mono">
                  {isRunning ? `Running ${elapsedStr}…` : elapsedStr ? `Finished in ${elapsedStr}` : ""}
                </span>
              )}
              <span className="opacity-60">Timeout: {phase.timeout}</span>
            </div>
          </div>

          {apiError && (
            <p className="mt-3 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">
              {apiError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Log viewer */}
      {(logs.length > 0 || isRunning) && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader className="p-3 border-b border-border/40">
            <button
              className="flex items-center justify-between w-full"
              onClick={() => setLogsOpen(v => !v)}
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Output {logs.length > 0 && `(${logs.length} lines)`}
                </span>
              </div>
              {logsOpen
                ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
          </CardHeader>

          <AnimatePresence initial={false}>
            {logsOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                transition={{ duration: 0.15 }}
                style={{ overflow: "hidden" }}
              >
                <div className="bg-zinc-950 max-h-[420px] overflow-y-auto p-4 font-mono text-[11px] leading-[1.6] space-y-px">
                  {logs.length === 0 && isRunning && (
                    <span className="text-zinc-500 animate-pulse">Starting…</span>
                  )}
                  {logs.map((line, i) => (
                    <div key={i} className={`whitespace-pre-wrap break-all ${lineClass(line)}`}>
                      {stripAnsi(line)}
                    </div>
                  ))}
                  {isRunning && (
                    <div className="flex items-center gap-1 text-yellow-400 pt-1">
                      <span className="inline-block w-1.5 h-3 bg-yellow-400 animate-pulse" />
                    </div>
                  )}
                  <div ref={logEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}
    </motion.div>
  );
}

// ─── Runner tab root ──────────────────────────────────────────────────────────

export function RunnerTab({
  onReportLoaded,
}: {
  onReportLoaded: (storageKey: string, data: unknown) => void;
}) {
  const [activePhase, setActivePhase] = useState("1");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Terminal className="w-4 h-4" />
        </div>
        <div>
          <h2 className="font-semibold text-sm">Test Runner</h2>
          <p className="text-xs text-muted-foreground">
            Execute each phase directly from the panel. Reports are loaded automatically on success.
          </p>
        </div>
      </div>

      <Tabs value={activePhase} onValueChange={setActivePhase}>
        <TabsList className="h-9 flex flex-wrap gap-0.5">
          {PHASES.map(p => (
            <TabsTrigger key={p.id} value={p.id} className="gap-1.5 text-xs h-7 px-3">
              {p.icon}
              <span className="hidden sm:inline">Phase {p.id}</span>
              <span className="sm:hidden">{p.id}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {PHASES.map(p => (
          <TabsContent key={p.id} value={p.id} className="mt-4">
            <PhasePanel phase={p} onReportLoaded={onReportLoaded} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
