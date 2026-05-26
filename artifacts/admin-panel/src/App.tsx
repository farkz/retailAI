import { useState, useEffect, useCallback } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Clipboard, Check, Database, XCircle, CheckCircle2, Clock, UploadCloud, CornerDownRight, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

interface Phase1Report {
  runAt: string;
  franchise: { id: string; name: string };
  offerGroups: {
    race: { id: string; name: string };
    bingo: { id: string; name: string };
  };
  costCenters: Array<{
    id: string;
    name: string;
    code: string;
    terminal: string;
    betshop: string;
  }>;
  steps: Array<{
    step: number;
    label: string;
    status: 'pass' | 'fail' | 'pending';
  }>;
}

const MOCK_DATA: Phase1Report = {
  runAt: new Date().toISOString(),
  franchise: { id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", name: "farkas-2026-05-26-081234" },
  offerGroups: {
    race: { id: "f2c3b4a1-d5e6-4f7a-8b9c-d0e1f2a3b4c5", name: "Race OG Default" },
    bingo: { id: "c3b4a1f2-e6d5-4a7f-9c8b-5d4c3b2a1f0e", name: "Bingo OG Default" }
  },
  costCenters: [
    { id: "1a2b3c4d-5e6f-4a7b-8c9d-e0f1a2b3c4d5", name: "Cost Center Alpha", code: "CCA-1", terminal: "t1a2b3c4-d5e6-4f7a-8b9c-d0e1f2a3b4c5", betshop: "b1a2b3c4-d5e6-4f7a-8b9c-d0e1f2a3b4c5" },
    { id: "2b3c4d5e-6f7a-4b8c-9d0e-f1a2b3c4d5e6", name: "Cost Center Beta", code: "CCB-2", terminal: "t2b3c4d5-e6f7-4a8b-9c0d-e1f2a3b4c5d6", betshop: "b2b3c4d5-e6f7-4a8b-9c0d-e1f2a3b4c5d6" },
    { id: "3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f", name: "Cost Center Gamma", code: "CCG-3", terminal: "t3c4d5e6-f7a8-4b9c-0d1e-f2a3b4c5d6e7", betshop: "b3c4d5e6-f7a8-4b9c-0d1e-f2a3b4c5d6e7" },
    { id: "4d5e6f7a-8b9c-4d0e-1f2a-3b4c5d6e7f8a", name: "Cost Center Delta", code: "CCD-4", terminal: "t4d5e6f7-a8b9-4c0d-1e2f-a3b4c5d6e7f8", betshop: "b4d5e6f7-a8b9-4c0d-1e2f-a3b4c5d6e7f8" },
    { id: "5e6f7a8b-9c0d-4e1f-2a3b-4c5d6e7f8a9b", name: "Cost Center Epsilon", code: "CCE-5", terminal: "t5e6f7a8-b9c0-4d1e-f2a3-b4c5d6e7f8a9", betshop: "b5e6f7a8-b9c0-4d1e-f2a3-b4c5d6e7f8a9" }
  ],
  steps: [
    { step: 1, label: "Franchise created", status: "pass" },
    { step: 2, label: "Offer Groups created", status: "pass" },
    { step: 3, label: "Cost Centers created (5)", status: "pass" },
    { step: 4, label: "Locations linked to Offer Groups", status: "pass" },
    { step: 5, label: "Terminals & Betshops created", status: "pass" }
  ]
};

function CopyButton({ text, className = "" }: { text: string, className?: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "Copied!", description: "Copied to clipboard.", duration: 2000 });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-6 w-6 text-muted-foreground hover:text-primary ${className}`}
      onClick={handleCopy}
    >
      {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
    </Button>
  );
}

function truncate(id: string) {
  if (!id) return "";
  return id.substring(0, 8) + "...";
}

function CopyableId({ id, label = "" }: { id: string, label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-mono bg-muted/30 py-1 px-2 rounded-md border border-border/50 max-w-fit">
      {label && <span className="text-muted-foreground text-xs">{label}:</span>}
      <span className="text-foreground">{truncate(id)}</span>
      <CopyButton text={id} />
    </div>
  );
}

function StatusBadge({ status }: { status: 'pass' | 'fail' | 'pending' }) {
  if (status === 'pass') {
    return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20"><CheckCircle2 className="w-3 h-3 mr-1" /> PASS</Badge>;
  }
  if (status === 'fail') {
    return <Badge variant="destructive" className="bg-destructive/10 text-destructive border-destructive/20"><XCircle className="w-3 h-3 mr-1" /> FAIL</Badge>;
  }
  return <Badge variant="secondary" className="bg-muted text-muted-foreground border-muted"><Clock className="w-3 h-3 mr-1" /> PENDING</Badge>;
}

function Dashboard() {
  const [report, setReport] = useState<Phase1Report | null>(null);
  const [mode, setMode] = useState<'view' | 'import'>('view');
  const [importText, setImportText] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    // Force dark mode
    document.documentElement.classList.add("dark");
    
    const saved = localStorage.getItem("phase1_report");
    if (saved) {
      try {
        setReport(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved report", e);
      }
    }
  }, []);

  const saveReport = (data: Phase1Report) => {
    setReport(data);
    localStorage.setItem("phase1_report", JSON.stringify(data));
    setMode('view');
    toast({ title: "Report loaded", description: "Successfully loaded phase 1 test results." });
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      // naive validation
      if (!parsed.franchise || !parsed.costCenters) throw new Error("Invalid format");
      saveReport(parsed);
    } catch (e) {
      toast({ title: "Import failed", description: "Could not parse JSON. Check the format.", variant: "destructive" });
    }
  };

  const loadExample = () => {
    setImportText(JSON.stringify(MOCK_DATA, null, 2));
  };

  const copyAllIds = () => {
    if (!report) return;
    const lines = [
      `Franchise: ${report.franchise.id}`,
      `Race OG: ${report.offerGroups.race.id}`,
      `Bingo OG: ${report.offerGroups.bingo.id}`,
      ...report.costCenters.flatMap(cc => [
        `CC ${cc.code}: ${cc.id}`,
        `Terminal ${cc.code}: ${cc.terminal}`,
        `Betshop ${cc.code}: ${cc.betshop}`
      ])
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast({ title: "Copied all IDs", description: "Copied to clipboard." });
  };

  const isPass = report?.steps.every(s => s.status === 'pass');

  if (!report && mode === 'view') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center space-y-6">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
            <Database className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">No Test Data Loaded</h1>
          <p className="text-muted-foreground">
            Run your Phase 1 automated tests, locate the <code className="bg-muted px-1.5 py-0.5 rounded text-primary">test-results/phase1-report.json</code> file, and import it here to view the command-center summary.
          </p>
          <Button size="lg" className="w-full" onClick={() => setMode('import')}>
            <UploadCloud className="w-4 h-4 mr-2" /> Import JSON Report
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 font-sans selection:bg-primary/30">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <h1 className="font-bold text-lg tracking-tight">Phase 1 Setup Report</h1>
            </div>
            {report && (
              <>
                <div className="w-px h-6 bg-border mx-2"></div>
                <StatusBadge status={isPass ? 'pass' : 'fail'} />
                <span className="text-sm text-muted-foreground font-mono">
                  {new Date(report.runAt).toLocaleString()}
                </span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {mode === 'view' ? (
              <>
                <Button variant="outline" size="sm" onClick={copyAllIds}>
                  <Copy className="w-4 h-4 mr-2" /> Copy All IDs
                </Button>
                <Button size="sm" onClick={() => setMode('import')}>
                  <UploadCloud className="w-4 h-4 mr-2" /> Import JSON
                </Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => report ? setMode('view') : null} disabled={!report}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <AnimatePresence mode="wait">
          {mode === 'import' ? (
            <motion.div key="import" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="border-primary/20 shadow-lg shadow-primary/5">
                <CardHeader>
                  <CardTitle>Import Phase 1 Report</CardTitle>
                  <CardDescription>
                    Paste the contents of your <code className="text-primary bg-primary/10 px-1 py-0.5 rounded">phase1-report.json</code> file below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea 
                    className="min-h-[300px] font-mono text-xs bg-muted/50 border-border/50" 
                    placeholder="{ ... }"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />
                  <div className="flex justify-between items-center">
                    <Button variant="ghost" size="sm" onClick={loadExample} className="text-muted-foreground">
                      Load Example Data
                    </Button>
                    <Button onClick={handleImport} disabled={!importText.trim()}>
                      Load Report
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ) : report ? (
            <motion.div key="view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-8">
              
              {/* Section 1: Franchise */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">1. Franchise Setup</h2>
                <Card className="bg-card border-border overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                  <CardContent className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Franchise Name</p>
                        <h3 className="text-2xl font-bold tracking-tight text-foreground">{report.franchise.name}</h3>
                      </div>
                      <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                        <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">Franchise ID</p>
                        <div className="flex items-center gap-2 font-mono text-sm">
                          <span className="text-primary">{report.franchise.id}</span>
                          <CopyButton text={report.franchise.id} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Section 2 & 3 Side by side */}
                <div className="md:col-span-2 space-y-8">
                  
                  {/* Section 2: Offer Groups */}
                  <section className="space-y-4">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">2. Offer Groups</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Card className="bg-card border-border">
                        <CardContent className="p-5 space-y-3">
                          <div className="flex justify-between items-start">
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">Race</Badge>
                            <span className="text-xs text-muted-foreground font-mono">OG</span>
                          </div>
                          <p className="font-semibold text-lg">{report.offerGroups.race.name}</p>
                          <CopyableId id={report.offerGroups.race.id} label="ID" />
                        </CardContent>
                      </Card>
                      <Card className="bg-card border-border">
                        <CardContent className="p-5 space-y-3">
                          <div className="flex justify-between items-start">
                            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">Bingo</Badge>
                            <span className="text-xs text-muted-foreground font-mono">OG</span>
                          </div>
                          <p className="font-semibold text-lg">{report.offerGroups.bingo.name}</p>
                          <CopyableId id={report.offerGroups.bingo.id} label="ID" />
                        </CardContent>
                      </Card>
                    </div>
                  </section>

                  {/* Section 4: Cost Centers */}
                  <section className="space-y-4">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">4. Cost Centers & Terminals</h2>
                    <Card className="border-border bg-card overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow className="border-border/50">
                            <TableHead className="w-12 text-center">#</TableHead>
                            <TableHead>Code & Name</TableHead>
                            <TableHead>Cost Center ID</TableHead>
                            <TableHead>Terminal ID</TableHead>
                            <TableHead>Betshop ID</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.costCenters.map((cc, i) => (
                            <TableRow key={cc.id} className="border-border/50 hover:bg-muted/20">
                              <TableCell className="text-center font-mono text-muted-foreground">{i + 1}</TableCell>
                              <TableCell>
                                <div className="font-medium">{cc.code}</div>
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

                {/* Section 3: Timeline */}
                <div className="md:col-span-1">
                  <section className="space-y-4 sticky top-24">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">3. Execution Steps</h2>
                    <Card className="border-border bg-card">
                      <CardContent className="p-6">
                        <div className="space-y-6">
                          {report.steps.map((step, index) => (
                            <div key={step.step} className="flex gap-4 relative">
                              {index < report.steps.length - 1 && (
                                <div className="absolute left-2.5 top-6 bottom-[-24px] w-px bg-border"></div>
                              )}
                              <div className="relative z-10 bg-card">
                                {step.status === 'pass' && <CheckCircle2 className="w-5 h-5 text-primary" />}
                                {step.status === 'fail' && <XCircle className="w-5 h-5 text-destructive" />}
                                {step.status === 'pending' && <div className="w-5 h-5 rounded-full border-2 border-muted-foreground" />}
                              </div>
                              <div className="-mt-0.5 space-y-1">
                                <p className={`font-medium ${step.status === 'pending' ? 'text-muted-foreground' : 'text-foreground'}`}>
                                  {step.label}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">Step {step.step}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                </div>
              </div>

            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}

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
