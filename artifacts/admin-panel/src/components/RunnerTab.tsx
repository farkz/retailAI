import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, RotateCcw, CheckCircle2, XCircle, Clock,
  Terminal, ChevronDown, ChevronUp, Layers, TrendingUp,
  Dices, Ticket, Zap, AlertTriangle, Hash, Users, Receipt,
  TrendingDown, Trophy, BarChart3, Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";

// ─── Types ───────────────────────────────────────────────────────────────────

type RunStatus = "idle" | "running" | "pass" | "fail";

interface PhaseStatus {
  running: boolean;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  logLines: number;
}

interface MochaStats {
  passing: number;
  failing: number;
  pending: number;
  duration: string | null;
  steps: Array<{ label: string; status: "pass" | "fail"; duration?: string }>;
  errors: string[];
}

// ─── Phase definitions ───────────────────────────────────────────────────────

interface PhaseDef {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ReactNode;
  timeoutSec: number;
  storageKey: string;
}

const PHASES: PhaseDef[] = [
  {
    id: "1",
    label: "Phase 1 — Setup",
    shortLabel: "Setup",
    description: "Creates franchise, offer groups, cost centres and terminals.",
    icon: <Layers className="w-4 h-4" />,
    timeoutSec: 180,
    storageKey: "phase1_report",
  },
  {
    id: "2",
    label: "Phase 2 — Race Payin",
    shortLabel: "Race Payin",
    description: "Logs in to each terminal and places virtual race tickets.",
    icon: <Zap className="w-4 h-4" />,
    timeoutSec: 300,
    storageKey: "phase2_report",
  },
  {
    id: "3",
    label: "Phase 3 — Race Payout",
    shortLabel: "Race Payout",
    description: "Pays out won race tickets via the integration API and records win-tax.",
    icon: <TrendingUp className="w-4 h-4" />,
    timeoutSec: 600,
    storageKey: "phase3_report",
  },
  {
    id: "4",
    label: "Phase 4 — Bingo Payin",
    shortLabel: "Bingo Payin",
    description: "Places virtual bingo tickets on each terminal.",
    icon: <Dices className="w-4 h-4" />,
    timeoutSec: 600,
    storageKey: "phase4_report",
  },
  {
    id: "5",
    label: "Phase 5 — Bingo Payout",
    shortLabel: "Bingo Payout",
    description: "Pays out won bingo tickets and records win-tax.",
    icon: <Ticket className="w-4 h-4" />,
    timeoutSec: 600,
    storageKey: "phase5_report",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function elapsedMs(start: string | null, end?: string | null): number {
  if (!start) return 0;
  return new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
}

function fmtElapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmt(n: number, dec = 2): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function statusBorderBg(status: RunStatus): string {
  if (status === "running") return "border-yellow-500/30 bg-yellow-500/5";
  if (status === "pass")    return "border-primary/30 bg-primary/5";
  if (status === "fail")    return "border-destructive/30 bg-destructive/5";
  return "border-border bg-card";
}

function statusIconBg(status: RunStatus): string {
  if (status === "running") return "bg-yellow-500/15 text-yellow-400";
  if (status === "pass")    return "bg-primary/15 text-primary";
  if (status === "fail")    return "bg-destructive/15 text-destructive";
  return "bg-muted/50 text-muted-foreground";
}

function statusTextColor(status: RunStatus): string {
  if (status === "running") return "text-yellow-400";
  if (status === "pass")    return "text-primary";
  if (status === "fail")    return "text-destructive";
  return "text-muted-foreground";
}

// ─── ANSI stripping ───────────────────────────────────────────────────────────

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

// ─── Mocha log parser ─────────────────────────────────────────────────────────

function parseMochaStats(lines: string[]): MochaStats {
  const stats: MochaStats = { passing: 0, failing: 0, pending: 0, duration: null, steps: [], errors: [] };
  let inError = false;
  let errorBuf: string[] = [];

  for (const raw of lines) {
    const s = stripAnsi(raw).trim();

    // passing/failing/pending summary lines  e.g. "  5 passing (3s)"
    const passMatch = s.match(/^(\d+)\s+passing(?:\s+\(([^)]+)\))?/i);
    if (passMatch) {
      stats.passing = parseInt(passMatch[1]);
      if (passMatch[2]) stats.duration = passMatch[2];
      inError = false;
      continue;
    }
    const failMatch = s.match(/^(\d+)\s+failing/i);
    if (failMatch) { stats.failing = parseInt(failMatch[1]); inError = false; continue; }
    const pendMatch = s.match(/^(\d+)\s+pending/i);
    if (pendMatch) { stats.pending = parseInt(pendMatch[1]); inError = false; continue; }

    // Passing step:  ✓ Step name (123ms)
    const passStep = s.match(/^✓\s+(.+?)(?:\s+\((\d+[ms]+)\))?$/);
    if (passStep) {
      stats.steps.push({ label: passStep[1].trim(), status: "pass", duration: passStep[2] });
      inError = false;
      continue;
    }

    // Failing step:  ✗ Step name  OR   N) Suite step name
    const failStep = s.match(/^(?:✗|[0-9]+\))\s+(.+)$/);
    if (failStep && !s.startsWith("AssertionError") && !s.startsWith("Error:") && !s.startsWith("at ")) {
      const label = failStep[1].replace(/^\d+\)\s+/, "").trim();
      if (label && label.length < 120) {
        stats.steps.push({ label, status: "fail" });
        inError = true;
        errorBuf = [];
      }
      continue;
    }

    // Error body lines
    if (inError) {
      if (s.startsWith("at ") && errorBuf.length > 1) { inError = false; continue; }
      errorBuf.push(s);
      if (errorBuf.length === 1 && s) stats.errors.push(s);
    }
  }

  return stats;
}

// ─── Report metrics (from localStorage) ──────────────────────────────────────

interface MetricItem { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: boolean; warn?: boolean }

function extractReportMetrics(phaseId: string, storageKey: string): MetricItem[] | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw);
    if (phaseId === "1") {
      const cc: unknown[] = r.costCenters ?? [];
      return [
        { label: "Franchise", value: r.franchise?.name ?? "—", icon: <Hash className="w-3.5 h-3.5" /> },
        { label: "Cost Centres", value: String(cc.length), icon: <Users className="w-3.5 h-3.5" />, accent: true },
        { label: "Race OG", value: r.offerGroups?.race?.name ?? "—", icon: <TrendingUp className="w-3.5 h-3.5" /> },
        { label: "Bingo OG", value: r.offerGroups?.bingo?.name ?? "—", icon: <Dices className="w-3.5 h-3.5" /> },
        { label: "Steps", value: `${r.steps?.filter((s: { status: string }) => s.status === "pass").length ?? 0} / ${r.steps?.length ?? 0}`, icon: <CheckCircle2 className="w-3.5 h-3.5" />, accent: true },
      ];
    }
    if (phaseId === "2") {
      const terminals: unknown[] = r.terminals ?? [];
      const totalTickets = terminals.reduce((s: number, t: unknown) => s + ((t as { tickets?: unknown[] }).tickets?.length ?? 0), 0);
      const confirmed = terminals.reduce((s: number, t: unknown) => {
        return s + ((t as { tickets?: Array<{ status: string }> }).tickets?.filter(tk => tk.status === "confirmed").length ?? 0);
      }, 0);
      const failed = totalTickets - confirmed;
      const totalAmount = terminals.reduce((s: number, t: unknown) => {
        return s + ((t as { tickets?: Array<{ status: string; amount?: number }> }).tickets?.filter(tk => tk.status === "confirmed").reduce((ss, tk) => ss + (tk.amount ?? 0), 0) ?? 0);
      }, 0);
      return [
        { label: "Terminals", value: String(terminals.length), icon: <Users className="w-3.5 h-3.5" /> },
        { label: "Tickets Placed", value: String(totalTickets), icon: <Ticket className="w-3.5 h-3.5" />, accent: true },
        { label: "Confirmed", value: String(confirmed), icon: <CheckCircle2 className="w-3.5 h-3.5" />, accent: true },
        { label: "Failed", value: String(failed), icon: <XCircle className="w-3.5 h-3.5" />, warn: failed > 0 },
        { label: "Total Payin", value: `${fmt(totalAmount)} €`, icon: <Receipt className="w-3.5 h-3.5" />, accent: true },
      ];
    }
    if (phaseId === "3" || phaseId === "5") {
      const sum = r.summary ?? {};
      const cats: Array<{ amount: number; percentage: number }> = r.winTaxCategories ?? [];
      const threshold = cats.length ? Math.min(...cats.map(c => c.amount)) : r.winTaxThreshold;
      return [
        { label: "Won Tickets", value: String(sum.wonTicketsTotal ?? 0), icon: <Trophy className="w-3.5 h-3.5" />, accent: true },
        { label: "Paid Out", value: String(sum.paidOutCount ?? 0), sub: `${fmt(sum.paidOutAmount ?? 0)} €`, icon: <CheckCircle2 className="w-3.5 h-3.5" />, accent: true },
        { label: "Failed Payout", value: String(sum.failedPayoutCount ?? 0), sub: sum.failedPayoutCount > 0 ? `${fmt(sum.failedPayoutAmount ?? 0)} €` : undefined, icon: <XCircle className="w-3.5 h-3.5" />, warn: (sum.failedPayoutCount ?? 0) > 0 },
        { label: "Lost Tickets", value: String(sum.lostTicketsTotal ?? 0), icon: <TrendingDown className="w-3.5 h-3.5" /> },
        { label: "Taxable", value: String(sum.taxableTicketCount ?? 0), sub: `${fmt(sum.totalWinTax ?? 0)} € tax`, icon: <Receipt className="w-3.5 h-3.5" />, accent: (sum.taxableTicketCount ?? 0) > 0 },
        { label: "Tax Threshold", value: threshold != null ? `${fmt(threshold)} €` : "—", icon: <BarChart3 className="w-3.5 h-3.5" /> },
      ];
    }
    if (phaseId === "4") {
      const sum = r.summary ?? {};
      const terminals: unknown[] = r.terminals ?? [];
      return [
        { label: "Terminals", value: String(sum.terminalsProcessed ?? terminals.length), icon: <Users className="w-3.5 h-3.5" /> },
        { label: "Tickets Attempted", value: String(sum.totalTicketsAttempted ?? 0), icon: <Ticket className="w-3.5 h-3.5" /> },
        { label: "Confirmed", value: String(sum.totalTicketsConfirmed ?? 0), icon: <CheckCircle2 className="w-3.5 h-3.5" />, accent: true },
        { label: "Failed", value: String(sum.totalTicketsFailed ?? 0), icon: <XCircle className="w-3.5 h-3.5" />, warn: (sum.totalTicketsFailed ?? 0) > 0 },
        { label: "Total Payin", value: `${fmt(sum.totalPayinAmount ?? 0)} ${r.currency ?? "€"}`, icon: <Receipt className="w-3.5 h-3.5" />, accent: true },
        { label: "Per Terminal", value: String(r.ticketsPerTerminal ?? "—"), icon: <Hash className="w-3.5 h-3.5" /> },
      ];
    }
    return null;
  } catch { return null; }
}

// ─── UI sub-components ────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: RunStatus }) {
  if (status === "running") return (
    <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/20 gap-1 shrink-0">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />Running
    </Badge>
  );
  if (status === "pass") return (
    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 gap-1 shrink-0">
      <CheckCircle2 className="w-3 h-3" />Pass
    </Badge>
  );
  if (status === "fail") return (
    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 gap-1 shrink-0">
      <XCircle className="w-3 h-3" />Fail
    </Badge>
  );
  return (
    <Badge variant="outline" className="bg-muted/50 text-muted-foreground border-border/50 gap-1 shrink-0">
      <Clock className="w-3 h-3" />Idle
    </Badge>
  );
}

function MiniMetric({ item }: { item: MetricItem }) {
  return (
    <div className={`flex flex-col gap-0.5 px-3 py-2.5 rounded-lg border ${item.accent ? "bg-primary/5 border-primary/20" : item.warn ? "bg-destructive/5 border-destructive/20" : "bg-muted/20 border-border/40"}`}>
      <div className={`flex items-center gap-1.5 ${item.accent ? "text-primary" : item.warn ? "text-destructive" : "text-muted-foreground"}`}>
        {item.icon}
        <span className="text-[10px] uppercase tracking-wide font-medium">{item.label}</span>
      </div>
      <span className={`font-bold text-sm tabular-nums ${item.accent ? "text-primary" : item.warn ? "text-destructive" : "text-foreground"}`}>{item.value}</span>
      {item.sub && <span className="text-[10px] text-muted-foreground">{item.sub}</span>}
    </div>
  );
}

function MochaStatsBar({ stats, isRunning }: { stats: MochaStats; isRunning: boolean }) {
  if (!isRunning && stats.passing === 0 && stats.failing === 0) return null;
  return (
    <div className="flex items-center gap-3 flex-wrap text-xs py-2 px-1">
      {(stats.passing > 0 || isRunning) && (
        <span className="flex items-center gap-1 text-emerald-400 font-semibold">
          <CheckCircle2 className="w-3 h-3" />{stats.passing} passing
        </span>
      )}
      {stats.failing > 0 && (
        <span className="flex items-center gap-1 text-red-400 font-semibold">
          <XCircle className="w-3 h-3" />{stats.failing} failing
        </span>
      )}
      {stats.pending > 0 && (
        <span className="flex items-center gap-1 text-yellow-400">
          <Clock className="w-3 h-3" />{stats.pending} pending
        </span>
      )}
      {stats.duration && (
        <span className="flex items-center gap-1 text-muted-foreground ml-auto">
          <Timer className="w-3 h-3" />{stats.duration}
        </span>
      )}
    </div>
  );
}

function StepList({ steps, errors }: { steps: MochaStats["steps"]; errors: string[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="space-y-0.5">
      {steps.map((step, i) => (
        <div key={i} className={`flex items-start gap-2 text-xs px-1 py-0.5 rounded ${step.status === "pass" ? "text-zinc-300" : "text-red-300 bg-red-500/5"}`}>
          {step.status === "pass"
            ? <CheckCircle2 className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
            : <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />}
          <span className="flex-1">{step.label}</span>
          {step.duration && <span className="text-zinc-600 font-mono shrink-0">{step.duration}</span>}
        </div>
      ))}
      {errors.length > 0 && (
        <div className="mt-2 p-2 rounded bg-red-500/8 border border-red-500/20 space-y-1">
          {errors.slice(0, 3).map((e, i) => (
            <p key={i} className="text-[11px] font-mono text-red-300 break-all">{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Phase overview card ──────────────────────────────────────────────────────

interface PhaseOverviewState {
  status: RunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  passing: number;
  failing: number;
}

function PhaseOverviewGrid({
  states,
  activePhase,
  onSelect,
}: {
  states: Record<string, PhaseOverviewState>;
  activePhase: string;
  onSelect: (id: string) => void;
}) {
  const allDone = PHASES.every(p => states[p.id]?.status !== "idle");
  const totalPass = PHASES.filter(p => states[p.id]?.status === "pass").length;
  const totalFail = PHASES.filter(p => states[p.id]?.status === "fail").length;
  const anyRunning = PHASES.some(p => states[p.id]?.status === "running");

  return (
    <Card className="border-border/50">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Phase Overview</CardTitle>
          </div>
          {allDone && (
            <div className="flex items-center gap-3 text-xs">
              {totalFail === 0
                ? <span className="flex items-center gap-1 text-primary font-semibold"><CheckCircle2 className="w-3.5 h-3.5" />All phases passed</span>
                : <span className="flex items-center gap-1 text-destructive font-semibold"><AlertTriangle className="w-3.5 h-3.5" />{totalFail} failed</span>}
            </div>
          )}
          {anyRunning && (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />Running…
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-1">
        <div className="grid grid-cols-5 gap-2">
          {PHASES.map(p => {
            const st = states[p.id] ?? { status: "idle" as RunStatus, passing: 0, failing: 0, startedAt: null, finishedAt: null };
            const active = activePhase === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all text-center
                  ${active ? "ring-1 ring-primary/50" : ""}
                  ${st.status === "running" ? "border-yellow-500/30 bg-yellow-500/5" : st.status === "pass" ? "border-primary/20 bg-primary/5 hover:bg-primary/10" : st.status === "fail" ? "border-destructive/20 bg-destructive/5 hover:bg-destructive/10" : "border-border/50 bg-muted/10 hover:bg-muted/20"}`}
              >
                <div className={`${statusIconBg(st.status)} p-1.5 rounded-md`}>{p.icon}</div>
                <span className="text-[10px] font-medium text-muted-foreground leading-tight">{p.shortLabel}</span>
                <RunStatusBadge status={st.status} />
                {(st.status === "pass" || st.status === "fail") && st.passing + st.failing > 0 && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {st.passing}✓{st.failing > 0 ? ` ${st.failing}✗` : ""}
                  </span>
                )}
                {st.startedAt && st.status !== "running" && (
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {fmtElapsed(elapsedMs(st.startedAt, st.finishedAt))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Combined progress bar */}
        {(totalPass + totalFail > 0) && (
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>{totalPass} of {PHASES.length} phases passed</span>
              <span>{Math.round((totalPass / PHASES.length) * 100)}%</span>
            </div>
            <Progress value={(totalPass / PHASES.length) * 100} className="h-1.5" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Per-phase panel ─────────────────────────────────────────────────────────

function PhasePanel({
  phase,
  onReportLoaded,
  onStateChange,
}: {
  phase: PhaseDef;
  onReportLoaded: (key: string, data: unknown) => void;
  onStateChange: (id: string, state: Partial<PhaseOverviewState>) => void;
}) {
  const [status, setStatus]       = useState<RunStatus>("idle");
  const [phaseInfo, setPhaseInfo] = useState<PhaseStatus | null>(null);
  const [logs, setLogs]           = useState<string[]>([]);
  const [logsOpen, setLogsOpen]   = useState(true);
  const [stepsOpen, setStepsOpen] = useState(true);
  const [apiError, setApiError]   = useState<string | null>(null);
  const [, setTick]               = useState(0);
  const [reportMetrics, setReportMetrics] = useState<MetricItem[] | null>(null);

  const sseRef    = useRef<EventSource | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const mochaStats = useMemo(() => parseMochaStats(logs), [logs]);

  // Propagate state to parent for overview
  useEffect(() => {
    onStateChange(phase.id, {
      status,
      startedAt: phaseInfo?.startedAt ?? null,
      finishedAt: phaseInfo?.finishedAt ?? null,
      passing: mochaStats.passing,
      failing: mochaStats.failing,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mochaStats.passing, mochaStats.failing, phaseInfo?.startedAt, phaseInfo?.finishedAt]);

  // Load report metrics when status changes to pass
  useEffect(() => {
    if (status === "pass") {
      setReportMetrics(extractReportMetrics(phase.id, phase.storageKey));
    }
  }, [status, phase.id, phase.storageKey]);

  // Tick for elapsed timer while running
  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Poll on mount
  useEffect(() => {
    fetchStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

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
        setReportMetrics(extractReportMetrics(phase.id, phase.storageKey));
      } else if (data.exitCode !== null) {
        setStatus("fail");
      }
    } catch {
      setApiError("Runner server unavailable — start the dev server to enable test execution.");
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
      const newStatus: RunStatus = exitCode === 0 ? "pass" : "fail";
      setStatus(newStatus);
      setPhaseInfo(prev => prev ? { ...prev, running: false, exitCode, finishedAt: new Date().toISOString() } : prev);
      es.close();
      sseRef.current = null;
      setTimeout(() => {
        const raw = localStorage.getItem(phase.storageKey);
        if (raw) {
          try { onReportLoaded(phase.storageKey, JSON.parse(raw)); } catch {}
        }
        setReportMetrics(extractReportMetrics(phase.id, phase.storageKey));
      }, 1500);
    });

    es.onerror = () => { es.close(); sseRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.id]);

  const handleRun = async () => {
    setLogs([]);
    setStatus("running");
    setLogsOpen(true);
    setStepsOpen(true);
    setApiError(null);
    setReportMetrics(null);
    try {
      const r = await fetch(`/api/phases/${phase.id}/run`, { method: "POST" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setApiError(err.error ?? "Failed to start");
        setStatus("idle");
        return;
      }
      const data = await r.json();
      setPhaseInfo(prev => ({ ...(prev ?? { logLines: 0 }), running: true, exitCode: null, startedAt: data.startedAt, finishedAt: null }));
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
    setPhaseInfo(prev => prev ? { ...prev, running: false, exitCode: -1, finishedAt: new Date().toISOString() } : prev);
  };

  const handleClear = () => {
    setLogs([]);
    setStatus("idle");
    setPhaseInfo(null);
    setReportMetrics(null);
  };

  const isRunning = status === "running";
  const isDone    = status === "pass" || status === "fail";
  const elapsedNow = elapsedMs(phaseInfo?.startedAt ?? null, phaseInfo?.finishedAt ?? null);
  const progressPct = isRunning ? Math.min(99, (elapsedNow / (phase.timeoutSec * 1000)) * 100) : (status === "pass" ? 100 : 0);

  return (
    <motion.div key={phase.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">

      {/* ── Header card ── */}
      <Card className={`border ${statusBorderBg(status)}`}>
        <CardHeader className="p-5 pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${statusIconBg(status)}`}>{phase.icon}</div>
              <div>
                <CardTitle className={`text-base ${statusTextColor(status)}`}>{phase.label}</CardTitle>
                <CardDescription className="mt-0.5">{phase.description}</CardDescription>
              </div>
            </div>
            <RunStatusBadge status={status} />
          </div>
        </CardHeader>

        <CardContent className="p-5 pt-0 space-y-3">
          {/* Buttons + timing */}
          <div className="flex items-center gap-2 flex-wrap">
            {!isRunning ? (
              <Button size="sm" onClick={handleRun} className="gap-1.5" disabled={!!apiError}>
                <Play className="w-3.5 h-3.5" />{isDone ? "Re-run" : "Run Phase"}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={handleStop} className="gap-1.5">
                <Square className="w-3.5 h-3.5" />Stop
              </Button>
            )}
            {isDone && (
              <Button size="sm" variant="ghost" onClick={handleClear} className="gap-1.5 text-muted-foreground">
                <RotateCcw className="w-3.5 h-3.5" />Clear
              </Button>
            )}
            <div className="flex items-center gap-3 ml-auto text-xs text-muted-foreground">
              {phaseInfo?.startedAt && (
                <span className="font-mono flex items-center gap-1">
                  <Timer className="w-3 h-3" />
                  {isRunning ? `${fmtElapsed(elapsedNow)} elapsed` : `${fmtElapsed(elapsedNow)} total`}
                </span>
              )}
              <span className="opacity-50">max {fmtElapsed(phase.timeoutSec * 1000)}</span>
            </div>
          </div>

          {/* Progress bar */}
          {(isRunning || status === "pass") && (
            <div className="space-y-1">
              <Progress
                value={progressPct}
                className={`h-1 ${status === "pass" ? "[&>div]:bg-primary" : "[&>div]:bg-yellow-400"}`}
              />
              {isRunning && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  ~{Math.max(0, Math.round(phase.timeoutSec - elapsedNow / 1000))}s remaining (estimate)
                </p>
              )}
            </div>
          )}
          {status === "fail" && (
            <Progress value={progressPct} className="h-1 [&>div]:bg-destructive" />
          )}

          {apiError && (
            <p className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded px-3 py-2">{apiError}</p>
          )}
        </CardContent>
      </Card>

      {/* ── Mocha stats + step list ── */}
      {(mochaStats.steps.length > 0 || (mochaStats.passing + mochaStats.failing) > 0) && (
        <Card className="border-border/50">
          <CardHeader className="p-3 pb-0">
            <button className="flex items-center justify-between w-full" onClick={() => setStepsOpen(v => !v)}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Test Steps</span>
              </div>
              {stepsOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
            <MochaStatsBar stats={mochaStats} isRunning={isRunning} />
          </CardHeader>
          <AnimatePresence initial={false}>
            {stepsOpen && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: "hidden" }}>
                <CardContent className="px-4 pb-4 pt-1">
                  <StepList steps={mochaStats.steps} errors={mochaStats.errors} />
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {/* ── Report metrics ── */}
      {reportMetrics && reportMetrics.length > 0 && (
        <Card className="border-primary/20 bg-primary/3">
          <CardHeader className="p-4 pb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wide">Phase {phase.id} Report Metrics</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {reportMetrics.map((item, i) => <MiniMetric key={i} item={item} />)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Log viewer ── */}
      {(logs.length > 0 || isRunning) && (
        <Card className="border-border/50 overflow-hidden">
          <CardHeader className="p-3 border-b border-border/40">
            <button className="flex items-center justify-between w-full" onClick={() => setLogsOpen(v => !v)}>
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Output {logs.length > 0 && `· ${logs.length} lines`}
                </span>
              </div>
              {logsOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
            </button>
          </CardHeader>
          <AnimatePresence initial={false}>
            {logsOpen && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.15 }} style={{ overflow: "hidden" }}>
                <div className="bg-zinc-950 max-h-[400px] overflow-y-auto p-4 font-mono text-[11px] leading-[1.6] space-y-px">
                  {logs.length === 0 && isRunning && <span className="text-zinc-500 animate-pulse">Starting…</span>}
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
  const [overviewStates, setOverviewStates] = useState<Record<string, PhaseOverviewState>>({});

  const handleStateChange = useCallback((id: string, state: Partial<PhaseOverviewState>) => {
    setOverviewStates(prev => ({ ...prev, [id]: { ...prev[id], ...state } as PhaseOverviewState }));
  }, []);

  return (
    <div className="space-y-4">
      {/* Overview grid */}
      <PhaseOverviewGrid
        states={overviewStates}
        activePhase={activePhase}
        onSelect={setActivePhase}
      />

      {/* Per-phase sub-tabs */}
      <Tabs value={activePhase} onValueChange={setActivePhase}>
        <TabsList className="h-9">
          {PHASES.map(p => {
            const st = overviewStates[p.id]?.status ?? "idle";
            return (
              <TabsTrigger key={p.id} value={p.id} className="gap-1.5 text-xs h-7 px-3">
                <span className={`${st === "running" ? "text-yellow-400" : st === "pass" ? "text-primary" : st === "fail" ? "text-destructive" : ""}`}>
                  {p.icon}
                </span>
                <span className="hidden sm:inline">Phase {p.id}</span>
                <span className="sm:hidden">{p.id}</span>
                {st === "running" && <span className="w-1 h-1 rounded-full bg-yellow-400 animate-pulse" />}
                {st === "pass"    && <span className="w-1 h-1 rounded-full bg-primary" />}
                {st === "fail"    && <span className="w-1 h-1 rounded-full bg-destructive" />}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {PHASES.map(p => (
          <TabsContent key={p.id} value={p.id} className="mt-4">
            <PhasePanel
              phase={p}
              onReportLoaded={onReportLoaded}
              onStateChange={handleStateChange}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
