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
  ChevronDown, ChevronUp, Dices, Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import NotFound from "@/pages/not-found";

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

interface Phase3TerminalWon {
  count: number;
  paidOutCount: number;
  failedPayoutCount: number;
  totalWinAmount: number;
  paidOutAmount: number;
  failedPayoutAmount: number;
  taxableCount: number;
  totalWinTax: number;
}

interface Phase3TerminalEntry {
  terminalId: string;
  wonTickets: Phase3TerminalWon;
  lostTickets: { count: number };
  payouts: Array<{
    ticketId: string;
    userId: string;
    effectiveWinAmount: number;
    taxable: boolean;
    winTax: number;
    pin: string;
    success: boolean;
    error?: string;
  }>;
  lostTicketIds: string[];
}

interface Phase3Summary {
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

interface Phase3Report {
  runAt: string;
  franchiseId: string;
  winTaxThreshold: number;
  winTaxRate: number;
  summary: Phase3Summary;
  terminals: Phase3TerminalEntry[];
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

// ─── Phase 1 tab ─────────────────────────────────────────────────────────────

function Phase1View({ report, onImport }: { report: Phase1Report | null; onImport: () => void }) {
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
      {/* Header row */}
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

      {/* Franchise */}
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
          {/* Offer Groups */}
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

          {/* Cost Centers */}
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

        {/* Steps */}
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

// ─── Phase 3 tab ─────────────────────────────────────────────────────────────

function normalizePhase3Report(raw: any): Phase3Report {
  const TAX_THRESHOLD: number = raw.winTaxThreshold ?? 100.01;
  const TAX_RATE: number = raw.winTaxRate ?? 0.15;

  // Already new format — has wonTickets sub-object
  if (raw.summary && raw.terminals?.[0]?.wonTickets !== undefined) {
    return raw as Phase3Report;
  }

  // Old format: terminals[].{ terminalId, payoutCount, payouts[].{ winAmount: string } }
  const terminals: Phase3TerminalEntry[] = (raw.terminals ?? []).map((t: any) => {
    const payouts = (t.payouts ?? []).map((p: any) => {
      const effectiveWinAmount = parseFloat(String(p.winAmount ?? p.effectiveWinAmount ?? 0));
      const taxable = effectiveWinAmount > TAX_THRESHOLD;
      const winTax = taxable && p.success ? parseFloat((effectiveWinAmount * TAX_RATE).toFixed(2)) : 0;
      return {
        ticketId: p.ticketId ?? "",
        userId: p.userId ?? "",
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

    const wonTickets: Phase3TerminalWon = {
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

  const sumT = (key: keyof Phase3TerminalWon) =>
    parseFloat(terminals.reduce((s, t) => s + (t.wonTickets[key] as number), 0).toFixed(2));

  const summary: Phase3Summary = {
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
    winTaxThreshold:  TAX_THRESHOLD,
    winTaxRate:       TAX_RATE,
    summary,
    terminals,
    steps: raw.steps ?? [],
  };
}

function Phase3TerminalRow({ t, idx }: { t: Phase3TerminalEntry; idx: number }) {
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

function Phase3View({ report, onReportChange }: { report: Phase3Report | null; onReportChange: (r: Phase3Report | null) => void }) {
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();

  if (!report && !showImport) {
    return (
      <EmptyState
        label="No Phase 3 Data"
        description="Run your Phase 3 payout tests, then import the phase3-report.json file."
        onImport={() => setShowImport(true)}
      />
    );
  }

  if (showImport) {
    return (
      <ImportPanel
        title="Import Phase 3 Race Payout Report"
        description=""
        fileName="phase3-report.json"
        onLoad={(parsed) => {
          if (!parsed.franchiseId) throw new Error("Invalid format: missing franchiseId");
          const r = normalizePhase3Report(parsed);
          localStorage.setItem("phase3_report", JSON.stringify(r));
          onReportChange(r);
          setShowImport(false);
          toast({ title: "Phase 3 report loaded" });
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
    <motion.div key="p3-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <StatusBadge status={isPass ? "pass" : "fail"} />
          <span className="text-sm text-muted-foreground font-mono">{new Date(report.runAt).toLocaleString()}</span>
          <Badge variant="outline" className="text-xs font-mono">
            Tax ≥ {fmt(report.winTaxThreshold)} € @ {(report.winTaxRate * 100).toFixed(0)}%
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
          <UploadCloud className="w-4 h-4 mr-2" />Re-import
        </Button>
      </div>

      {/* Franchise ID */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">Franchise</span>
        <CopyableId id={report.franchiseId} />
      </div>

      {/* Summary stat cards */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Summary</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <StatCard label="Won Tickets" value={String(s.wonTicketsTotal)} icon={<Trophy className="w-4 h-4" />} />
          <StatCard label="Paid Out" value={`${s.paidOutCount}`} sub={`${fmt(s.paidOutAmount)} €`} icon={<TrendingUp className="w-4 h-4" />} accent />
          <StatCard label="Failed Payout" value={`${s.failedPayoutCount}`} sub={s.failedPayoutCount > 0 ? `${fmt(s.failedPayoutAmount)} €` : undefined} icon={<Ban className="w-4 h-4" />} warn={s.failedPayoutCount > 0} />
          <StatCard label="Lost Tickets" value={String(s.lostTicketsTotal)} icon={<XCircle className="w-4 h-4" />} />
          <StatCard label="Total Win Amount" value={`${fmt(s.totalWinAmount)} €`} icon={<Layers className="w-4 h-4" />} />
          <StatCard label="Taxable Tickets" value={String(s.taxableTicketCount)} sub={`above ${fmt(report.winTaxThreshold)} €`} icon={<Receipt className="w-4 h-4" />} />
          <StatCard label="Total Win Tax" value={`${fmt(s.totalWinTax)} €`} sub={`${(report.winTaxRate * 100).toFixed(0)}% rate`} icon={<Receipt className="w-4 h-4" />} warn={s.totalWinTax > 0} />
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
                  <Phase3TerminalRow key={t.terminalId} t={t} idx={i} />
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard() {
  const [phase1, setPhase1] = useState<Phase1Report | null>(null);
  const [phase3, setPhase3] = useState<Phase3Report | null>(null);
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
            <TabsTrigger value="phase1" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />Phase 1 — Setup
            </TabsTrigger>
            <TabsTrigger value="phase3" className="gap-1.5 text-xs">
              <TrendingUp className="w-3.5 h-3.5" />Phase 3 — Race Payout
            </TabsTrigger>
            <TabsTrigger value="phase4" className="gap-1.5 text-xs">
              <Dices className="w-3.5 h-3.5" />Phase 4 — Bingo Payout
            </TabsTrigger>
            <TabsTrigger value="phase5" className="gap-1.5 text-xs">
              <Ticket className="w-3.5 h-3.5" />Phase 5 — Post Ticket
            </TabsTrigger>
          </TabsList>

          <TabsContent value="phase1">
            <Phase1View
              report={phase1}
              onImport={() => {
                const saved = localStorage.getItem("phase1_report");
                if (saved) setPhase1(JSON.parse(saved));
              }}
            />
          </TabsContent>

          <TabsContent value="phase3">
            <Phase3View report={phase3} onReportChange={setPhase3} />
          </TabsContent>

          <TabsContent value="phase4">
            <ComingSoonPanel icon={<Dices className="w-8 h-8" />} label="Bingo Payout" phaseNum={4} />
          </TabsContent>

          <TabsContent value="phase5">
            <ComingSoonPanel icon={<Ticket className="w-8 h-8" />} label="Post Ticket" phaseNum={5} />
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
