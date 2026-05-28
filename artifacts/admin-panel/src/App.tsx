import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clipboard, Check, Database, XCircle, CheckCircle2, Clock,
  UploadCloud, Copy, TrendingUp, Ban, Receipt, Trophy, Layers,
  ChevronDown, ChevronUp, Dices, Ticket, Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import NotFound from "@/pages/not-found";
import { RunnerTab } from "@/components/RunnerTab";

const queryClient = new QueryClient();

// ─── Types ───────────────────────────────────────────────────────────────────

interface Phase1Report {
  runAt: string;
  franchise: { id: string; name: string };
  offerGroups: {
    race: { id: string; name: string };
    bingo: { id: string; name: string };
  };
  costCenters: Array<{ id: string; name: string; code: string; terminal: string; betshop: string }>;
  steps: Array<{ step: number; label: string; status: "pass" | "fail" | "pending" }>;
}

interface PayoutTerminalWon {
  count: number;
  paidOutCount: number;
  failedPayoutCount: number;
  totalWinAmount: number;
  paidOutAmount: number;
  failedPayoutAmount: number;
  taxableCount: number;
  totalWinTax: number;
}

interface PayoutTerminalEntry {
  terminalId: string;
  wonTickets: PayoutTerminalWon;
  lostTickets: { count: number };
  payouts: Array<{
    ticketId: string;
    userId: string;
    payinAmount: number;
    effectiveWinAmount: number;
    taxable: boolean;
    winTax: number;
    pin: string;
    success: boolean;
    error?: string;
  }>;
  lostTicketIds: string[];
}

interface PayoutSummary {
  wonTicketsTotal: number;
  paidOutCount: number;
  failedPayoutCount: number;
  totalWinAmount: number;
  paidOutAmount: number;
  failedPayoutAmount: number;
  taxableTicketCount: number;
  totalWinTax: number;
  lostTicketsTotal: number;
}

interface WinTaxCategory {
  amount: number;
  percentage: number;
}

interface PayoutReport {
  runAt: string;
  franchiseId: string;
  winTaxThreshold: number;
  winTaxRate: number;
  winTaxCategories: WinTaxCategory[];
  summary: PayoutSummary;
  terminals: PayoutTerminalEntry[];
  steps: Array<{ step: number; label: string; status: "pass" | "fail" | "pending" }>;
}

// Legacy alias kept for Phase 3 normaliser
type Phase3TerminalWon = PayoutTerminalWon;
type Phase3TerminalEntry = PayoutTerminalEntry;
type Phase3Summary = PayoutSummary;
type Phase3Report = PayoutReport;

// ─── Phase 4 types ────────────────────────────────────────────────────────────

interface Phase4Ticket {
  betType: string;
  betContent: string;
  amount: number;
  actionId: string;
  payinMode: string;
  status: "confirmed" | "failed" | "timeout";
  failReason: string | null;
  pollingAttempts: number;
}

interface Phase4TerminalReport {
  terminalId: string;
  locationId: string;
  roundId: string;
  roundNumber: number;
  tickets: Phase4Ticket[];
}

interface Phase4Report {
  runAt: string;
  franchiseId: string;
  bingoOfferGroupId: string;
  currency: string;
  minPayin: number;
  ticketsPerTerminal: number;
  summary: {
    terminalsProcessed: number;
    totalTicketsAttempted: number;
    totalTicketsConfirmed: number;
    totalTicketsFailed: number;
    totalPayinAmount: number;
  };
  terminals: Phase4TerminalReport[];
  steps: Array<{ step: number; label: string; status: "pass" | "fail" | "pending" }>;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function truncate(id: string) {
  if (!id) return "—";
  return id.length > 13 ? id.substring(0, 8) + "…" + id.slice(-4) : id;
}

function fmt(n: number | undefined, decimals = 2) {
  if (n == null) return "—";
  return n.toLocaleString("de-DE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied!", duration: 1500 });
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="icon" className={`h-6 w-6 text-muted-foreground hover:text-primary ${className}`} onClick={handleCopy}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
    </Button>
  );
}

function CopyableId({ id, label = "" }: { id: string; label?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono bg-muted/30 py-0.5 px-2 rounded border border-border/50 max-w-fit">
      {label && <span className="text-muted-foreground">{label}:</span>}
      <span className="text-foreground" title={id}>{truncate(id)}</span>
      <CopyButton text={id} />
    </div>
  );
}

function StatusBadge({ status }: { status: "pass" | "fail" | "pending" }) {
  if (status === "pass") return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20"><CheckCircle2 className="w-3 h-3 mr-1" />PASS</Badge>;
  if (status === "fail") return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20"><XCircle className="w-3 h-3 mr-1" />FAIL</Badge>;
  return <Badge variant="secondary" className="bg-muted text-muted-foreground"><Clock className="w-3 h-3 mr-1" />PENDING</Badge>;
}

function StepsTimeline({ steps }: { steps: Array<{ step: number; label: string; status: "pass" | "fail" | "pending" }> }) {
  return (
    <div className="space-y-5">
      {steps.map((step, index) => (
        <div key={step.step} className="flex gap-3 relative">
          {index < steps.length - 1 && (
            <div className="absolute left-2.5 top-5 bottom-[-20px] w-px bg-border" />
          )}
          <div className="relative z-10 bg-card pt-0.5">
            {step.status === "pass"    && <CheckCircle2 className="w-5 h-5 text-primary" />}
            {step.status === "fail"    && <XCircle className="w-5 h-5 text-destructive" />}
            {step.status === "pending" && <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />}
          </div>
          <div className="-mt-0.5">
            <p className={`font-medium text-sm ${step.status === "pending" ? "text-muted-foreground" : "text-foreground"}`}>{step.label}</p>
            <p className="text-xs text-muted-foreground font-mono">Step {step.step}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportPanel({
  title, description, fileName, onLoad, onCancel, canCancel,
}: {
  title: string; description: string; fileName: string;
  onLoad: (parsed: any) => void; onCancel: () => void; canCancel: boolean;
}) {
  const [text, setText] = useState("");
  const { toast } = useToast();

  const handleImport = () => {
    try {
      const parsed = JSON.parse(text);
      onLoad(parsed);
    } catch {
      toast({ title: "Import failed", description: "Could not parse JSON. Check the format.", variant: "destructive" });
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
      <Card className="border-primary/20 shadow-lg shadow-primary/5">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            Paste the contents of your{" "}
            <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">{fileName}</code> file below.
            {description && <> {description}</>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            className="min-h-[300px] font-mono text-xs bg-muted/50 border-border/50"
            placeholder="{ ... }"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-between items-center">
            {canCancel ? (
              <Button variant="ghost" size="sm" onClick={onCancel} className="text-muted-foreground">Cancel</Button>
            ) : <span />}
            <Button onClick={handleImport} disabled={!text.trim()}>Load Report</Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─── Summary stat card ───────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, accent = false, warn = false,
}: { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: boolean; warn?: boolean }) {
  return (
    <Card className={`border ${accent ? "border-primary/30 bg-primary/5" : warn ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"}`}>
      <CardContent className="p-4 flex gap-3 items-start">
        <div className={`mt-0.5 p-1.5 rounded-md ${accent ? "bg-primary/15 text-primary" : warn ? "bg-destructive/15 text-destructive" : "bg-muted/60 text-muted-foreground"}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5 uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-bold tabular-nums ${accent ? "text-primary" : warn ? "text-destructive" : "text-foreground"}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Phase 4 summary card (shown on Phase 1 tab) ─────────────────────────────

function Phase4SummaryCard({
  report,
  onGoToPhase4,
}: {
  report: Phase4Report | null;
  onGoToPhase4: () => void;
}) {
  const [open, setOpen] = useState(true);

  if (!report) {
    return (
      <Card className="border-dashed border-border/60 bg-muted/10">
        <CardContent className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Dices className="w-4 h-4 shrink-0" />
            <span className="text-sm">Phase 4 (Bingo Payin) not loaded yet.</span>
          </div>
          <Button variant="outline" size="sm" onClick={onGoToPhase4} className="shrink-0">
            Go to Phase 4
          </Button>
        </CardContent>
      </Card>
    );
  }

  const s = report.summary;

  interface TerminalSummary {
    terminalId: string;
    confirmed: number;
    failed: number;
    payin: number;
  }

  const terminalRows: TerminalSummary[] = report.terminals.map((t) => {
    const confirmed = t.tickets.filter((tk) => tk.status === "confirmed").length;
    const failed = t.tickets.length - confirmed;
    const payin = t.tickets
      .filter((tk) => tk.status === "confirmed")
      .reduce((sum, tk) => sum + tk.amount, 0);
    return { terminalId: t.terminalId, confirmed, failed, payin };
  });

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="p-4 pb-0">
        <button
          className="flex items-center justify-between w-full group"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Dices className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold text-primary">Phase 4 — Bingo Payin Summary</CardTitle>
            <span className="text-xs text-muted-foreground font-mono ml-2">
              {new Date(report.runAt).toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              {s.totalTicketsConfirmed}/{s.totalTicketsAttempted} confirmed · {fmt(s.totalPayinAmount)} {report.currency}
            </Badge>
            {open
              ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
              : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </button>
      </CardHeader>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="p4-summary-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <CardContent className="p-4 pt-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Terminals"
                  value={String(s.terminalsProcessed)}
                  icon={<Database className="w-4 h-4" />}
                />
                <StatCard
                  label="Confirmed"
                  value={String(s.totalTicketsConfirmed)}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  accent
                />
                <StatCard
                  label="Failed / Timeout"
                  value={String(s.totalTicketsFailed)}
                  icon={<XCircle className="w-4 h-4" />}
                  warn={s.totalTicketsFailed > 0}
                />
                <StatCard
                  label="Total Payin"
                  value={`${fmt(s.totalPayinAmount)} ${report.currency}`}
                  icon={<Receipt className="w-4 h-4" />}
                  accent
                />
              </div>

              <div className="overflow-hidden rounded-md border border-border/50">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="border-border/50">
                      <TableHead className="w-8 text-center">#</TableHead>
                      <TableHead>Terminal ID</TableHead>
                      <TableHead className="text-right">Confirmed</TableHead>
                      <TableHead className="text-right">Failed</TableHead>
                      <TableHead className="text-right">Payin</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {terminalRows.map((row, i) => (
                      <TableRow key={row.terminalId} className="border-border/50 hover:bg-muted/20">
                        <TableCell className="text-center font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell><CopyableId id={row.terminalId} /></TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={row.confirmed > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>
                            {row.confirmed}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={row.failed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
                            {row.failed}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-mono text-sm">
                          {fmt(row.payin)} {report.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-end">
                <Button variant="ghost" size="sm" onClick={onGoToPhase4} className="text-xs text-muted-foreground">
                  <Dices className="w-3.5 h-3.5 mr-1.5" />View full Phase 4 report
                </Button>
              </div>
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─── Phase 1 tab ─────────────────────────────────────────────────────────────

function Phase1View({ report, phase4, onImport, onGoToPhase4 }: { report: Phase1Report | null; phase4: Phase4Report | null; onImport: () => void; onGoToPhase4: () => void }) {
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();

  const copyAllIds = () => {
    if (!report) return;
    const lines = [
      `Franchise: ${report.franchise.id}`,
      `Race OG: ${report.offerGroups.race.id}`,
      `Bingo OG: ${report.offerGroups.bingo.id}`,
      ...report.costCenters.flatMap(cc => [
        `CC ${cc.code}: ${cc.id}`,
        `Terminal ${cc.code}: ${cc.terminal}`,
        `Betshop ${cc.code}: ${cc.betshop}`,
      ]),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copied all IDs" });
  };

  if (!report && !showImport) {
    return (
      <EmptyState
        label="No Phase 1 Data"
        description="Run your Phase 1 automated tests, then import the phase1-report.json file."
        onImport={() => setShowImport(true)}
      />
    );
  }

  if (showImport) {
    return (
      <ImportPanel
        title="Import Phase 1 Report"
        description=""
        fileName="phase1-report.json"
        onLoad={(parsed) => {
          if (!parsed.franchise || !parsed.costCenters) {
            throw new Error("Invalid format");
          }
          onImport();
          localStorage.setItem("phase1_report", JSON.stringify(parsed));
          setShowImport(false);
          toast({ title: "Phase 1 report loaded" });
        }}
        onCancel={() => setShowImport(false)}
        canCancel={!!report}
      />
    );
  }

  if (!report) return null;
  const isPass = report.steps.every(s => s.status === "pass");

  return (
    <motion.div key="p1-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <StatusBadge status={isPass ? "pass" : "fail"} />
          <span className="text-sm text-muted-foreground font-mono">{new Date(report.runAt).toLocaleString()}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyAllIds}><Copy className="w-4 h-4 mr-2" />Copy All IDs</Button>
          <Button size="sm" variant="outline" onClick={() => setShowImport(true)}><UploadCloud className="w-4 h-4 mr-2" />Re-import</Button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Phase 4 — Bingo Payin</h2>
        <Phase4SummaryCard report={phase4} onGoToPhase4={onGoToPhase4} />
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">1. Franchise Setup</h2>
        <Card className="overflow-hidden relative">
          <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
          <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Franchise Name</p>
              <h3 className="text-2xl font-bold">{report.franchise.name}</h3>
            </div>
            <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Franchise ID</p>
              <div className="flex items-center gap-2 font-mono text-sm">
                <span className="text-primary">{report.franchise.id}</span>
                <CopyButton text={report.franchise.id} />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">2. Offer Groups</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: "Race", data: report.offerGroups.race },
                { label: "Bingo", data: report.offerGroups.bingo },
              ].map(({ label, data }) => (
                <Card key={label}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">{label}</Badge>
                      <span className="text-xs text-muted-foreground font-mono">OG</span>
                    </div>
                    <p className="font-semibold">{data.name}</p>
                    <CopyableId id={data.id} label="ID" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">4. Cost Centers & Terminals</h2>
            <Card className="overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-border/50">
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>Code & Name</TableHead>
                    <TableHead>Cost Center ID</TableHead>
                    <TableHead>Terminal ID</TableHead>
                    <TableHead>Betshop ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.costCenters.map((cc, i) => (
                    <TableRow key={cc.id} className="border-border/50 hover:bg-muted/20">
                      <TableCell className="text-center font-mono text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{cc.code}</div>
                        <div className="text-xs text-muted-foreground">{cc.name}</div>
                      </TableCell>
                      <TableCell><CopyableId id={cc.id} /></TableCell>
                      <TableCell><CopyableId id={cc.terminal} /></TableCell>
                      <TableCell><CopyableId id={cc.betshop} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </section>
        </div>

        <div>
          <section className="space-y-3 sticky top-24">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">3. Execution Steps</h2>
            <Card>
              <CardContent className="p-5">
                <StepsTimeline steps={report.steps} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Shared payout report helpers ─────────────────────────────────────────────

const DEFAULT_WIN_TAX_CATEGORIES: WinTaxCategory[] = [
  { amount: 50.01,   percentage: 10 },
  { amount: 1500.01, percentage: 12 },
];

function computeWinTax(
  winAmount: number,
  categories: WinTaxCategory[],
  payinAmount = 0,
  isDeductible = true,
): number {
  const taxBase = isDeductible ? Math.max(0, winAmount - payinAmount) : winAmount;
  const tiers   = [...categories].sort((a, b) => a.amount - b.amount);
  let rawTax = 0;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (taxBase <= tier.amount) break;
    const nextFloor = tiers[i + 1]?.amount ?? Infinity;
    const band      = Math.min(taxBase, nextFloor) - tier.amount;
    rawTax += band * (tier.percentage / 100);
  }
  return Math.round(rawTax);
}

function normalizePayoutReport(raw: any): PayoutReport {
  const rawCats: WinTaxCategory[] = (raw.winTaxCategories ?? raw.WinTaxCategories ?? [])
    .map((c: any) => ({ amount: c.amount ?? c.Amount, percentage: c.percentage ?? c.Percentage }))
    .filter((c: WinTaxCategory) => c.amount != null && c.percentage != null);
  const categories: WinTaxCategory[] = rawCats.length > 0 ? rawCats : DEFAULT_WIN_TAX_CATEGORIES;
  const minThreshold = Math.min(...categories.map(c => c.amount));

  if (raw.summary && raw.terminals?.[0]?.wonTickets !== undefined) {
    return { ...raw as PayoutReport, winTaxCategories: raw.winTaxCategories ?? categories };
  }

  const terminals: PayoutTerminalEntry[] = (raw.terminals ?? []).map((t: any) => {
    const payouts = (t.payouts ?? []).map((p: any) => {
      const effectiveWinAmount = parseFloat(String(p.winAmount ?? p.effectiveWinAmount ?? 0));
      const payinAmount = parseFloat(String(p.payinAmount ?? 0));
      const winTax = p.success ? computeWinTax(effectiveWinAmount, categories, payinAmount) : 0;
      const taxable = winTax > 0;
      return {
        ticketId: p.ticketId ?? "",
        userId: p.userId ?? "",
        payinAmount,
        winAmount: effectiveWinAmount,
        jackpotWinAmount: 0,
        effectiveWinAmount,
        taxable,
        winTax,
        pin: p.pin ?? "",
        taxNumber: p.taxNumber ?? null,
        actionId: p.actionId ?? "",
        success: p.success ?? false,
        error: p.error,
      };
    });

    const paidOut = payouts.filter((p: any) => p.success);
    const failed  = payouts.filter((p: any) => !p.success);
    const taxablePayouts = paidOut.filter((p: any) => p.taxable);

    const sum = (arr: any[], key: string) =>
      parseFloat(arr.reduce((s: number, p: any) => s + (p[key] ?? 0), 0).toFixed(2));

    const wonTickets: PayoutTerminalWon = {
      count:              payouts.length,
      paidOutCount:       paidOut.length,
      failedPayoutCount:  failed.length,
      totalWinAmount:     sum(payouts, "effectiveWinAmount"),
      paidOutAmount:      sum(paidOut, "effectiveWinAmount"),
      failedPayoutAmount: sum(failed, "effectiveWinAmount"),
      taxableCount:       taxablePayouts.length,
      totalWinTax:        sum(taxablePayouts, "winTax"),
    };

    return {
      terminalId: t.terminalId,
      wonTickets,
      lostTickets: { count: 0 },
      payouts,
      lostTicketIds: [],
    };
  });

  const sumT = (key: keyof PayoutTerminalWon) =>
    parseFloat(terminals.reduce((s, t) => s + (t.wonTickets[key] as number), 0).toFixed(2));

  const summary: PayoutSummary = {
    wonTicketsTotal:     raw.wonTicketsFound ?? terminals.reduce((s, t) => s + t.wonTickets.count, 0),
    paidOutCount:        terminals.reduce((s, t) => s + t.wonTickets.paidOutCount, 0),
    failedPayoutCount:   terminals.reduce((s, t) => s + t.wonTickets.failedPayoutCount, 0),
    totalWinAmount:      sumT("totalWinAmount"),
    paidOutAmount:       sumT("paidOutAmount"),
    failedPayoutAmount:  sumT("failedPayoutAmount"),
    taxableTicketCount:  terminals.reduce((s, t) => s + t.wonTickets.taxableCount, 0),
    totalWinTax:         sumT("totalWinTax"),
    lostTicketsTotal:    0,
  };

  return {
    runAt:            raw.runAt,
    franchiseId:      raw.franchiseId,
    winTaxThreshold:  minThreshold,
    winTaxRate:       categories.length > 0 ? categories[0].percentage / 100 : 0.10,
    winTaxCategories: categories,
    summary,
    terminals,
    steps: raw.steps ?? [],
  };
}

// Keep Phase 3 alias so existing callers compile
const normalizePhase3Report = normalizePayoutReport;

// ─── Shared payout terminal row ───────────────────────────────────────────────

function PayoutTerminalRow({ t, idx }: { t: PayoutTerminalEntry; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const won = t.wonTickets;
  return (
    <>
      <TableRow
        className="border-border/50 hover:bg-muted/20 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <TableCell className="text-center font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
        <TableCell><CopyableId id={t.terminalId} /></TableCell>
        <TableCell className="text-right tabular-nums">{won.count}</TableCell>
        <TableCell className="text-right tabular-nums">
          <span className={won.paidOutCount > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>{won.paidOutCount}</span>
          <span className="text-xs text-muted-foreground ml-1">/ {fmt(won.paidOutAmount)} €</span>
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <span className={won.failedPayoutCount > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>{won.failedPayoutCount}</span>
          {won.failedPayoutCount > 0 && <span className="text-xs text-muted-foreground ml-1">/ {fmt(won.failedPayoutAmount)} €</span>}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">{t.lostTickets.count}</TableCell>
        <TableCell className="text-right tabular-nums">
          {won.taxableCount > 0
            ? <span className="text-amber-400 font-semibold">{fmt(won.totalWinTax)} €</span>
            : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="text-right">
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground inline" /> : <ChevronDown className="w-4 h-4 text-muted-foreground inline" />}
        </TableCell>
      </TableRow>
      {expanded && t.payouts.length > 0 && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={8} className="p-0">
            <div className="px-4 py-3 overflow-x-auto">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ticket breakdown</p>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/40">
                    <th className="text-left pb-1 pr-4">Ticket ID</th>
                    <th className="text-right pb-1 pr-4">Win €</th>
                    <th className="text-center pb-1 pr-4">Taxable</th>
                    <th className="text-right pb-1 pr-4">Tax €</th>
                    <th className="text-left pb-1 pr-4">PIN</th>
                    <th className="text-center pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {t.payouts.map(p => (
                    <tr key={p.ticketId} className="border-b border-border/20 last:border-0">
                      <td className="py-1 pr-4 text-muted-foreground" title={p.ticketId}>{truncate(p.ticketId)}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{fmt(p.effectiveWinAmount)}</td>
                      <td className="py-1 pr-4 text-center">{p.taxable ? <span className="text-amber-400">●</span> : "—"}</td>
                      <td className="py-1 pr-4 text-right tabular-nums text-amber-400">{p.taxable ? fmt(p.winTax) : "—"}</td>
                      <td className="py-1 pr-4 text-muted-foreground">{p.pin || "—"}</td>
                      <td className="py-1 text-center">
                        {p.success
                          ? <span className="text-primary">✓</span>
                          : <span className="text-destructive" title={p.error}>✗</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// Keep Phase 3 alias
const Phase3TerminalRow = PayoutTerminalRow;

// ─── Shared payout view ───────────────────────────────────────────────────────

function PayoutView({
  report,
  onReportChange,
  phase,
  importFileName,
  importTitle,
  storageKey,
}: {
  report: PayoutReport | null;
  onReportChange: (r: PayoutReport | null) => void;
  phase: number;
  importFileName: string;
  importTitle: string;
  storageKey: string;
}) {
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();

  if (!report && !showImport) {
    return (
      <EmptyState
        label={`No Phase ${phase} Data`}
        description={`Run your Phase ${phase} payout tests, then import the ${importFileName} file.`}
        onImport={() => setShowImport(true)}
      />
    );
  }

  if (showImport) {
    return (
      <ImportPanel
        title={importTitle}
        description=""
        fileName={importFileName}
        onLoad={(parsed) => {
          if (!parsed.franchiseId) throw new Error("Invalid format: missing franchiseId");
          const r = normalizePayoutReport(parsed);
          localStorage.setItem(storageKey, JSON.stringify(r));
          onReportChange(r);
          setShowImport(false);
          toast({ title: `Phase ${phase} report loaded` });
        }}
        onCancel={() => setShowImport(false)}
        canCancel={!!report}
      />
    );
  }

  if (!report) return null;
  const s = report.summary;
  const isPass = report.steps.every(st => st.status === "pass");

  return (
    <motion.div key={`p${phase}-view`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={isPass ? "pass" : "fail"} />
          <span className="text-sm text-muted-foreground font-mono">{new Date(report.runAt).toLocaleString()}</span>
          <Badge variant="outline" className="text-xs font-mono">
            Tax progressive:{" "}
            {(report.winTaxCategories ?? []).map((c, i) => (
              <span key={i}>{i > 0 ? " · " : ""}{c.percentage}% &gt;{fmt(c.amount)}€</span>
            ))}
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
          <UploadCloud className="w-4 h-4 mr-2" />Re-import
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Franchise</span>
        <CopyableId id={report.franchiseId} />
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="Won Tickets" value={String(s.wonTicketsTotal)} icon={<Trophy className="w-4 h-4" />} />
          <StatCard label="Paid Out" value={`${s.paidOutCount}`} sub={`${fmt(s.paidOutAmount)} €`} icon={<TrendingUp className="w-4 h-4" />} accent />
          <StatCard label="Failed Payout" value={`${s.failedPayoutCount}`} sub={s.failedPayoutCount > 0 ? `${fmt(s.failedPayoutAmount)} €` : undefined} icon={<Ban className="w-4 h-4" />} warn={s.failedPayoutCount > 0} />
          <StatCard label="Lost Tickets" value={String(s.lostTicketsTotal)} icon={<XCircle className="w-4 h-4" />} />
          <StatCard label="Total Win Amount" value={`${fmt(s.totalWinAmount)} €`} icon={<Layers className="w-4 h-4" />} />
          <StatCard label="Taxable Tickets" value={String(s.taxableTicketCount)} sub={`above ${fmt(report.winTaxThreshold)} €`} icon={<Receipt className="w-4 h-4" />} />
          <StatCard label="Total Win Tax" value={`${fmt(s.totalWinTax)} €`} sub="progressive rate" icon={<Receipt className="w-4 h-4" />} warn={s.totalWinTax > 0} />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Per-Terminal Breakdown</h2>
          <p className="text-xs text-muted-foreground">Click a row to expand individual ticket details.</p>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-border/50">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Paid Out</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Lost</TableHead>
                  <TableHead className="text-right">Win Tax</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.terminals.map((t, i) => (
                  <PayoutTerminalRow key={t.terminalId} t={t} idx={i} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div>
          <section className="space-y-3 sticky top-24">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Steps</h2>
            <Card>
              <CardContent className="p-5">
                <StepsTimeline steps={report.steps} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Phase 4 components ───────────────────────────────────────────────────────

function Phase4TerminalRow({ t, idx }: { t: Phase4TerminalReport; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const confirmed = t.tickets.filter(tk => tk.status === "confirmed").length;
  const failed = t.tickets.filter(tk => tk.status !== "confirmed").length;
  const totalAmount = t.tickets
    .filter(tk => tk.status === "confirmed")
    .reduce((s, tk) => s + tk.amount, 0);

  return (
    <>
      <TableRow
        className="border-border/50 hover:bg-muted/20 cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <TableCell className="text-center font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
        <TableCell><CopyableId id={t.terminalId} /></TableCell>
        <TableCell className="text-right tabular-nums">{t.tickets.length}</TableCell>
        <TableCell className="text-right tabular-nums">
          <span className={confirmed > 0 ? "text-primary font-semibold" : "text-muted-foreground"}>{confirmed}</span>
          {confirmed > 0 && <span className="text-xs text-muted-foreground ml-1">/ {fmt(totalAmount)} €</span>}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          <span className={failed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>{failed}</span>
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground text-right">{t.roundNumber}</TableCell>
        <TableCell className="w-8 text-right">
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground inline" /> : <ChevronDown className="w-4 h-4 text-muted-foreground inline" />}
        </TableCell>
      </TableRow>
      {expanded && t.tickets.length > 0 && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={7} className="p-0">
            <div className="px-4 py-3 overflow-x-auto">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ticket breakdown</p>
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted-foreground border-b border-border/40">
                    <th className="text-left pb-1 pr-4">Action ID</th>
                    <th className="text-left pb-1 pr-4">Bet Type</th>
                    <th className="text-right pb-1 pr-4">Amount €</th>
                    <th className="text-left pb-1 pr-4">Payin Mode</th>
                    <th className="text-center pb-1 pr-4">Polls</th>
                    <th className="text-center pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {t.tickets.map((tk, i) => (
                    <tr key={tk.actionId || i} className="border-b border-border/20 last:border-0">
                      <td className="py-1 pr-4 text-muted-foreground" title={tk.actionId}>{truncate(tk.actionId)}</td>
                      <td className="py-1 pr-4 text-muted-foreground">{tk.betType || "—"}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">{fmt(tk.amount)}</td>
                      <td className="py-1 pr-4 text-muted-foreground">{tk.payinMode || "—"}</td>
                      <td className="py-1 pr-4 text-center">{tk.pollingAttempts}</td>
                      <td className="py-1 text-center">
                        {tk.status === "confirmed"
                          ? <span className="text-primary">✓</span>
                          : <span className="text-destructive" title={tk.failReason ?? undefined}>{tk.status === "timeout" ? "⏱" : "✗"}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function Phase4View({ report, onReportChange }: { report: Phase4Report | null; onReportChange: (r: Phase4Report | null) => void }) {
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();

  if (!report && !showImport) {
    return (
      <EmptyState
        label="No Phase 4 Data"
        description="Run your Phase 4 bingo payin tests, then import the phase4-report.json file."
        onImport={() => setShowImport(true)}
      />
    );
  }

  if (showImport) {
    return (
      <ImportPanel
        title="Import Phase 4 Bingo Payin Report"
        description=""
        fileName="phase4-report.json"
        onLoad={(parsed) => {
          if (!parsed.franchiseId || !parsed.terminals) throw new Error("Invalid format");
          localStorage.setItem("phase4_report", JSON.stringify(parsed));
          onReportChange(parsed as Phase4Report);
          setShowImport(false);
          toast({ title: "Phase 4 report loaded" });
        }}
        onCancel={() => setShowImport(false)}
        canCancel={!!report}
      />
    );
  }

  if (!report) return null;
  const s = report.summary;
  const isPass = report.steps.every(st => st.status === "pass");

  return (
    <motion.div key="p4-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={isPass ? "pass" : "fail"} />
          <span className="text-sm text-muted-foreground font-mono">{new Date(report.runAt).toLocaleString()}</span>
          <Badge variant="outline" className="text-xs font-mono">
            {report.currency} · min payin {fmt(report.minPayin)} · {report.ticketsPerTerminal} tickets/terminal
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
          <UploadCloud className="w-4 h-4 mr-2" />Re-import
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground uppercase tracking-wide">Franchise</span>
          <CopyableId id={report.franchiseId} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground uppercase tracking-wide">Bingo OG</span>
          <CopyableId id={report.bingoOfferGroupId} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Terminals" value={String(s.terminalsProcessed)} icon={<Database className="w-4 h-4" />} />
          <StatCard label="Tickets Attempted" value={String(s.totalTicketsAttempted)} icon={<Ticket className="w-4 h-4" />} />
          <StatCard label="Confirmed" value={String(s.totalTicketsConfirmed)} icon={<CheckCircle2 className="w-4 h-4" />} accent />
          <StatCard label="Failed / Timeout" value={String(s.totalTicketsFailed)} icon={<XCircle className="w-4 h-4" />} warn={s.totalTicketsFailed > 0} />
          <StatCard label="Total Payin" value={`${fmt(s.totalPayinAmount)} €`} icon={<TrendingUp className="w-4 h-4" />} accent />
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Per-Terminal Breakdown</h2>
          <p className="text-xs text-muted-foreground">Click a row to expand individual ticket details.</p>
          <Card className="overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-border/50">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead className="text-right">Attempted</TableHead>
                  <TableHead className="text-right">Confirmed</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead className="text-right">Round #</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.terminals.map((t, i) => (
                  <Phase4TerminalRow key={t.terminalId} t={t} idx={i} />
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        <div>
          <section className="space-y-3 sticky top-24">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Execution Steps</h2>
            <Card>
              <CardContent className="p-5">
                <StepsTimeline steps={report.steps} />
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Phase 3 view (uses shared PayoutView) ────────────────────────────────────

function Phase3View({ report, onReportChange }: { report: PayoutReport | null; onReportChange: (r: PayoutReport | null) => void }) {
  return (
    <PayoutView
      report={report}
      onReportChange={onReportChange}
      phase={3}
      importFileName="phase3-report.json"
      importTitle="Import Phase 3 Race Payout Report"
      storageKey="phase3_report"
    />
  );
}

// ─── Phase 5 view ─────────────────────────────────────────────────────────────

function Phase5View({ report, onReportChange }: { report: PayoutReport | null; onReportChange: (r: PayoutReport | null) => void }) {
  return (
    <PayoutView
      report={report}
      onReportChange={onReportChange}
      phase={5}
      importFileName="phase5-report.json"
      importTitle="Import Phase 5 Bingo Payout Report"
      storageKey="phase5_report"
    />
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ label, description, onImport }: { label: string; description: string; onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
        <Database className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-xl font-bold">{label}</h2>
      <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      <Button size="lg" onClick={onImport}>
        <UploadCloud className="w-4 h-4 mr-2" />Import JSON Report
      </Button>
    </div>
  );
}

function ComingSoonPanel({ icon, label, phaseNum }: { icon: React.ReactNode; label: string; phaseNum: number }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <div className="w-16 h-16 bg-muted/40 rounded-full flex items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <h2 className="text-xl font-bold">Phase {phaseNum} — {label}</h2>
      <p className="text-muted-foreground max-w-sm">
        This report view is reserved for Phase {phaseNum} ({label}) test results. Import will be available once the test phase is implemented.
      </p>
      <Badge variant="secondary" className="text-xs">Coming soon</Badge>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const [phase1, setPhase1] = useState<Phase1Report | null>(null);
  const [phase3, setPhase3] = useState<PayoutReport | null>(null);
  const [phase4, setPhase4] = useState<Phase4Report | null>(null);
  const [phase5, setPhase5] = useState<PayoutReport | null>(null);
  const [activeTab, setActiveTab] = useState("phase1");

  useEffect(() => {
    document.documentElement.classList.add("dark");
    try {
      const p1 = localStorage.getItem("phase1_report");
      if (p1) setPhase1(JSON.parse(p1));
    } catch {}
    try {
      const p3 = localStorage.getItem("phase3_report");
      if (p3) setPhase3(JSON.parse(p3));
    } catch {}
    try {
      const p4 = localStorage.getItem("phase4_report");
      if (p4) setPhase4(JSON.parse(p4));
    } catch {}
    try {
      const p5 = localStorage.getItem("phase5_report");
      if (p5) setPhase5(JSON.parse(p5));
    } catch {}
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 font-sans selection:bg-primary/30">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3">
          <Database className="w-4 h-4 text-primary shrink-0" />
          <span className="font-bold text-sm tracking-tight whitespace-nowrap">RetailAI Backoffice</span>
          <div className="w-px h-5 bg-border mx-1" />
          <span className="text-xs text-muted-foreground hidden sm:block">Test Results</span>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-6xl">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6 h-10">
            <TabsTrigger value="runner" className="gap-1.5 text-xs">
              <Terminal className="w-3.5 h-3.5" />Run Tests
            </TabsTrigger>
            <TabsTrigger value="phase1" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />Phase 1 — Setup
            </TabsTrigger>
            <TabsTrigger value="phase3" className="gap-1.5 text-xs">
              <TrendingUp className="w-3.5 h-3.5" />Phase 3 — Race Payout
            </TabsTrigger>
            <TabsTrigger value="phase4" className="gap-1.5 text-xs">
              <Dices className="w-3.5 h-3.5" />Phase 4 — Bingo Payin
            </TabsTrigger>
            <TabsTrigger value="phase5" className="gap-1.5 text-xs">
              <Ticket className="w-3.5 h-3.5" />Phase 5 — Bingo Payout
            </TabsTrigger>
          </TabsList>

          <TabsContent value="runner">
            <RunnerTab
              onReportLoaded={(storageKey, data) => {
                localStorage.setItem(storageKey, JSON.stringify(data));
                if (storageKey === "phase1_report") setPhase1(data as Phase1Report);
                if (storageKey === "phase3_report") setPhase3(data as PayoutReport);
                if (storageKey === "phase4_report") setPhase4(data as Phase4Report);
                if (storageKey === "phase5_report") setPhase5(data as PayoutReport);
              }}
            />
          </TabsContent>

          <TabsContent value="phase1">
            <Phase1View
              report={phase1}
              phase4={phase4}
              onImport={() => {
                const saved = localStorage.getItem("phase1_report");
                if (saved) setPhase1(JSON.parse(saved));
              }}
              onGoToPhase4={() => setActiveTab("phase4")}
            />
          </TabsContent>

          <TabsContent value="phase3">
            <Phase3View report={phase3} onReportChange={setPhase3} />
          </TabsContent>

          <TabsContent value="phase4">
            <Phase4View report={phase4} onReportChange={setPhase4} />
          </TabsContent>

          <TabsContent value="phase5">
            <Phase5View report={phase5} onReportChange={setPhase5} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route component={NotFound} />
          </Switch>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
