import { useRoute, useLocation } from "wouter";
import { LIMITE_RENDA_PER_CAPITA, LIMITE_MULTIPLICADOR } from "@shared/schema";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAdminEnrollments, useUpdateEnrollmentStatus } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, CheckCircle2, XCircle, FileText, BrainCircuit,
  AlertTriangle, ArrowLeft, Eye, TrendingUp, Users, ShieldCheck, AlertCircle, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function AdminEnrollmentReview() {
  const [, params] = useRoute("/admin/enrollments/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id || "0");
  const { toast } = useToast();
  
  const { data: enrollments, isLoading } = useAdminEnrollments();
  const updateStatusMutation = useUpdateEnrollmentStatus();

  const enrollment = enrollments?.find((e: any) => e.id === id);

  if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  if (!enrollment) return <div className="p-8 text-center">Inscrição não encontrada</div>;

  // ── Family income summary (computed client-side for display) ─────────────────────────────────────────────────
  const INCOME_DOC_TYPES_CLIENT = new Set([
    "income_proof", "payslip_3", "payslip_6", "income_justification",
    "rural_declaration", "fishing_declaration", "inss_extract", "decore", "pro_labore_3",
  ]);
  const householdSize = enrollment.householdSize ?? 1;
  const allDocs: any[] = enrollment.documents ?? [];
  const incomeDocs = allDocs.filter((d) => INCOME_DOC_TYPES_CLIENT.has(d.type));

  // ── Payslip-3 mode: 3 contracheques → média = salário do solicitante ──────
  const payslip3Docs = allDocs.filter((d) => d.type === "payslip_3");
  const isPayslip3Mode = payslip3Docs.length > 0;
  const validPayslip3 = payslip3Docs.filter((d: any) => {
    const ocr = d.ocrData;
    return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
  });

  const validIncomeDocs = incomeDocs.filter((d) => {
    const ocr = d.ocrData;
    return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
  });

  // Family income docs: todos os income docs EXCETO payslip_3 (comprovantes dos outros membros)
  const familyIncomeDocs: any[] = isPayslip3Mode
    ? allDocs.filter((d: any) => INCOME_DOC_TYPES_CLIENT.has(d.type) && d.type !== "payslip_3")
    : [];
  const validFamilyIncomeDocs = familyIncomeDocs.filter((d: any) => {
    const ocr = d.ocrData;
    return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
  });

  // Progress / completeness
  const numOutrosMembros = Math.max(0, householdSize - 1);
  const incomeDocsSubmitted = isPayslip3Mode ? payslip3Docs.length : incomeDocs.length;
  const incomeDocsRequired  = isPayslip3Mode ? 3 : householdSize;
  const incomeComplete = isPayslip3Mode
    ? payslip3Docs.length >= 3  // family docs are optional in payslip-3 mode
    : incomeDocsSubmitted >= 1; // optional docs — just needs at least one
  const ocrComplete = isPayslip3Mode
    ? validPayslip3.length >= 3 && (numOutrosMembros === 0 || validFamilyIncomeDocs.length >= numOutrosMembros)
    : validIncomeDocs.length >= householdSize;

  // Per-capita calculation
  // Payslip-3: perCapita = (mediaAluno + mediaFamilia) / 2
  // Both modes: perCapita = totalFamilyIncome / householdSize (missing members = R$ 0)
  let mediaAluno: number | null = null;
  let mediaFamilia: number | null = null; // avg per family member, for display only
  let familyTotalP3 = 0; // sum of valid family income docs in payslip-3 mode
  let totalFamilyIncomeStd = 0;
  let perCapitaComputed: number | null = null;

  if (isPayslip3Mode) {
    if (validPayslip3.length >= 3) {
      mediaAluno = validPayslip3.slice(0, 3).reduce((s: number, d: any) => s + (d.ocrData.rendaTotal as number), 0) / 3;
    }
    familyTotalP3 = validFamilyIncomeDocs.reduce((s: number, d: any) => s + (d.ocrData.rendaTotal as number), 0);
    if (validFamilyIncomeDocs.length > 0) {
      mediaFamilia = familyTotalP3 / validFamilyIncomeDocs.length;
    }
    if (mediaAluno != null) {
      // Total = student income + sum of available family docs; missing members = R$ 0
      perCapitaComputed = Math.round((mediaAluno + familyTotalP3) / householdSize);
    }
  } else {
    totalFamilyIncomeStd = validIncomeDocs.reduce((sum: number, d: any) => sum + (d.ocrData.rendaTotal as number), 0);
    // Compute per capita with partial docs (missing members count as R$ 0 in total)
    if (validIncomeDocs.length > 0) {
      perCapitaComputed = Math.round(totalFamilyIncomeStd / householdSize);
    }
  }

  const handleStatusChange = async (status: 'approved' | 'rejected' | 'pending') => {
    try {
      await updateStatusMutation.mutateAsync({ id, status });
      const labels: Record<string,string> = { approved: 'aprovada', rejected: 'rejeitada', pending: 'pendente' };
      toast({ title: `Inscrição ${labels[status] ?? status} com sucesso` });
      setLocation('/admin/enrollments');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro", description: e.message });
    }
  };

  const getSystemRecommendation = () => {
    if (!incomeComplete) {
      return {
        text: `Aguardando comprovantes de renda`,
        sub: isPayslip3Mode
          ? `${incomeDocsSubmitted} de 3 contracheque(s) enviado(s). Renda per capita indisponível.`
          : `${incomeDocsSubmitted} de ${householdSize} membro(s) com comprovante enviado. Renda per capita indisponível.`,
        color: "text-amber-600",
        bg: "bg-amber-100",
      };
    }

    if (!ocrComplete) {
      return {
        text: "Revisão Manual Necessária",
        sub: isPayslip3Mode
          ? `${validPayslip3.length} de 3 contracheques com OCR automático. Os demais precisam de verificação manual.`
          : `${validIncomeDocs.length} de ${householdSize} comprovante(s) com OCR automático. Os demais precisam de verificação manual.`,
        color: "text-amber-600",
        bg: "bg-amber-100",
      };
    }

    const perCapita = perCapitaComputed ?? enrollment.perCapitaIncome;
    if (perCapita != null) {
      const eligible = perCapita <= LIMITE_RENDA_PER_CAPITA;
      const limiteStr = LIMITE_RENDA_PER_CAPITA.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      const eligibleSuffix = eligible ? ' (dentro do limite)' : ' (acima de R$ ' + limiteStr + ')';
      let subMsg: string;
      if (isPayslip3Mode && mediaAluno != null) {
        const partialNote = validFamilyIncomeDocs.length < numOutrosMembros ? ` (${validFamilyIncomeDocs.length}/${numOutrosMembros} familiar(es) com OCR)` : '';
        subMsg = 'Aluno R$ ' + mediaAluno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
          + ' + família R$ ' + familyTotalP3.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + partialNote
          + ' = R$ ' + (mediaAluno + familyTotalP3).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
          + ' ÷ ' + householdSize + ' = R$ ' + perCapita.toLocaleString('pt-BR') + ' per capita' + eligibleSuffix;
      } else {
        subMsg = 'Renda familiar R$ ' + totalFamilyIncomeStd.toLocaleString('pt-BR') + ' ÷ ' + householdSize + ' = R$ ' + perCapita.toLocaleString('pt-BR') + ' per capita' + eligibleSuffix;
      }
      return {
        text: eligible ? "Elegível" : "Não Elegível",
        sub: subMsg,
        color: eligible ? "text-green-600" : "text-red-600",
        bg: eligible ? "bg-green-100" : "bg-red-100",
      };
    }

    const raw = enrollment.income;
    if (!raw) return { text: "Dados insuficientes", sub: null, color: "text-amber-600", bg: "bg-amber-100" };
    const eligible = raw <= LIMITE_RENDA_PER_CAPITA;
    return {
      text: eligible ? "Elegível (Renda declarada)" : "Não Elegível (Renda declarada)",
      sub: null,
      color: eligible ? "text-green-600" : "text-red-600",
      bg: eligible ? "bg-green-100" : "bg-red-100",
    };
  };

  const recommendation = getSystemRecommendation();

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-secondary/20">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-16 px-4 border-b bg-background shrink-0 gap-4">
            <SidebarTrigger />
            <Button variant="ghost" size="icon" onClick={() => setLocation('/admin/enrollments')} className="rounded-full">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h2 className="font-display font-semibold text-lg">Analisar Inscrição #{id.toString().padStart(4, '0')}</h2>
          </header>
          
          <main className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Details & OCR */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Actions Card */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-semibold text-muted-foreground uppercase">Status Atual</span>
                      <Badge className="capitalize">{{ pending: 'Pendente', in_analysis: 'Em Análise', approved: 'Aprovado', rejected: 'Rejeitado' }[enrollment.status as string] ?? enrollment.status}</Badge>
                    </div>
                    
                    <Button 
                      onClick={() => handleStatusChange('approved')} 
                      disabled={updateStatusMutation.isPending}
                      className="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-md shadow-lg shadow-green-600/20"
                    >
                      <CheckCircle2 className="mr-2 h-5 w-5" /> Aprovar Inscrição
                    </Button>
                    <Button 
                      onClick={() => handleStatusChange('rejected')} 
                      disabled={updateStatusMutation.isPending}
                      variant="destructive"
                      className="w-full h-12 rounded-xl font-bold text-md shadow-lg shadow-red-600/20"
                    >
                      <XCircle className="mr-2 h-5 w-5" /> Rejeitar Inscrição
                    </Button>
                    <Button 
                      onClick={() => handleStatusChange('pending')} 
                      disabled={updateStatusMutation.isPending}
                      variant="outline"
                      className="w-full h-12 rounded-xl font-bold text-md"
                    >
                      Marcar como Pendente (Docs Necessários)
                    </Button>
                  </CardContent>
                </Card>

                {/* AI Analysis Card */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-display flex items-center text-lg">
                      <BrainCircuit className="w-5 h-5 mr-2 text-primary" />
                      Análise do Sistema
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className={`p-4 rounded-xl flex items-start gap-3 ${recommendation.bg}`}>
                      <AlertTriangle className={`w-5 h-5 shrink-0 ${recommendation.color}`} />
                      <div>
                        <p className={`font-bold text-sm ${recommendation.color}`}>Recomendação</p>
                        <p className={`text-sm mt-0.5 ${recommendation.color}`}>{recommendation.text}</p>
                        {recommendation.sub && (
                          <p className={`text-xs mt-1 opacity-80 ${recommendation.color}`}>{recommendation.sub}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Applicant Data */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                  <CardHeader>
                    <CardTitle className="font-display text-lg">Dados do Candidato</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { label: 'Nome', value: enrollment.name },
                      { label: 'CPF', value: enrollment.cpf },
                      { label: 'Data de Nascimento', value: enrollment.dateOfBirth },
                      { label: 'Renda Bruta Declarada', value: enrollment.income ? `R$ ${enrollment.income.toLocaleString('pt-BR')}` : null },
                      { label: 'Nº de pessoas na residência', value: enrollment.householdSize ?? null },
                      { label: 'Data de Inscrição', value: enrollment.createdAt ? format(new Date(enrollment.createdAt), 'dd/MM/yyyy HH:mm') : null },
                    ].map((item, i) => (
                      <div key={i} className="border-b last:border-0 pb-3 last:pb-0">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
                        <p className="font-medium text-foreground">{item.value || '-'}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Family Income Summary Card */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="font-display text-lg flex items-center gap-2">
                      <Users className="w-5 h-5 text-primary" />
                      Renda Per Capita Familiar
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Progress bar */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{isPayslip3Mode ? 'Contracheques enviados' : 'Comprovantes enviados'}</span>
                        <span className="font-semibold">
                          {incomeDocsSubmitted} / {incomeDocsRequired} {isPayslip3Mode ? 'contracheques' : 'membros'}
                        </span>
                      </div>
                      <Progress
                        value={(incomeDocsSubmitted / incomeDocsRequired) * 100}
                        className="h-2"
                      />
                      {!incomeComplete && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {isPayslip3Mode
                            ? `Aguardando ${incomeDocsRequired - incomeDocsSubmitted} contracheque(s)`
                            : `Aguardando ${incomeDocsRequired - incomeDocsSubmitted} comprovante(s)`}
                        </p>
                      )}
                      {incomeComplete && !ocrComplete && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {isPayslip3Mode
                            ? `${validPayslip3.length}/3 contracheques + ${validFamilyIncomeDocs.length}/${numOutrosMembros} familiar(es) com OCR — demais precisam revisão manual`
                            : `${validIncomeDocs.length} de ${householdSize} com OCR automático — demais precisam revisão manual`}
                        </p>
                      )}
                      {ocrComplete && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" />
                          Todos os comprovantes validados via OCR
                        </p>
                      )}
                    </div>

                    {/* Individual incomes */}
                    {isPayslip3Mode ? (
                      /* Payslip-3 mode: contracheques + comprovantes familiares + medias + fórmula */
                      (payslip3Docs.length > 0 || familyIncomeDocs.length > 0) && (
                        <div className="space-y-1 text-xs">
                          {/* Contracheques do solicitante */}
                          {payslip3Docs.map((d: any, i: number) => {
                            const ocr = d.ocrData;
                            const hasOcr = ocr && ocr.status !== "REVISAO_MANUAL" && ocr.rendaTotal > 0;
                            return (
                              <div key={d.id} className={`flex justify-between ${hasOcr ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'}`}>
                                <span>Contracheque {i + 1} – {d.name}</span>
                                <span className="font-medium tabular-nums">
                                  {hasOcr
                                    ? `R$ ${(ocr.rendaTotal as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                    : '— revisão manual'}
                                </span>
                              </div>
                            );
                          })}
                          {mediaAluno != null && (
                            <div className="flex justify-between font-semibold text-primary border-t pt-1 mt-1">
                              <span>Média do solicitante</span>
                              <span className="tabular-nums">R$ {mediaAluno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                          {/* Comprovantes dos familiares */}
                          {familyIncomeDocs.length > 0 && (
                            <>
                              <div className="pt-2 mt-1 border-t text-xs font-semibold text-muted-foreground/70">Comprovantes dos familiares</div>
                              {familyIncomeDocs.map((d: any, i: number) => {
                                const ocr = d.ocrData;
                                const hasOcr = ocr && ocr.status !== "REVISAO_MANUAL" && ocr.rendaTotal > 0;
                                return (
                                  <div key={d.id} className={`flex justify-between ${hasOcr ? 'text-muted-foreground' : 'text-muted-foreground/50 italic'}`}>
                                    <span>Familiar {i + 1} – {d.name}</span>
                                    <span className="font-medium tabular-nums">
                                      {hasOcr
                                        ? `R$ ${(ocr.rendaTotal as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                                        : '— revisão manual'}
                                    </span>
                                  </div>
                                );
                              })}
                              {mediaFamilia != null && (
                                <div className="flex justify-between font-semibold text-blue-600 border-t pt-1 mt-1">
                                  <span>Média dos familiares</span>
                                  <span className="tabular-nums">R$ {mediaFamilia.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                                </div>
                              )}
                            </>
                          )}
                          {/* Fórmula final */}
                          {mediaAluno != null && (
                            <div className="flex justify-between font-semibold text-purple-700 border-t pt-1 mt-1">
                              <span>
                                (aluno + família{validFamilyIncomeDocs.length < numOutrosMembros ? `*` : ''}) ÷ {householdSize} pessoas
                              </span>
                              <span className="tabular-nums">R$ {perCapitaComputed?.toLocaleString('pt-BR') ?? '—'}</span>
                            </div>
                          )}
                          {mediaAluno != null && validFamilyIncomeDocs.length < numOutrosMembros && numOutrosMembros > 0 && (
                            <p className="text-xs text-amber-600 italic">* {validFamilyIncomeDocs.length}/{numOutrosMembros} familiar(es) com OCR — demais contam como R$ 0</p>
                          )}
                        </div>
                      )
                    ) : (
                      /* Standard mode */
                      validIncomeDocs.length > 0 && (
                        <div className="space-y-1 text-xs">
                          {validIncomeDocs.map((d: any, i: number) => (
                            <div key={d.id} className="flex justify-between text-muted-foreground">
                              <span>Membro {i + 1} – {d.name}</span>
                              <span className="font-medium tabular-nums">
                                R$ {(d.ocrData.rendaTotal as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          ))}
                          {incomeDocs.filter((d: any) => !validIncomeDocs.includes(d)).map((d: any, i: number) => (
                            <div key={d.id} className="flex justify-between text-muted-foreground/50 italic">
                              <span>Doc {validIncomeDocs.length + i + 1} – {d.name} (revisão manual)</span>
                              <span>—</span>
                            </div>
                          ))}
                        </div>
                      )
                    )}

                    {/* Aggregate — apenas no modo padrão (payslip-3 já mostra o breakdown acima) */}
                    {!isPayslip3Mode && validIncomeDocs.length > 0 && (
                      <div className="border-t pt-3 space-y-2 text-sm">
                        <div className="flex justify-between font-semibold">
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-4 h-4" />
                            Renda (OCR) somada
                          </span>
                          <span className="tabular-nums">R$ {totalFamilyIncomeStd.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                        </div>
                        {perCapitaComputed != null ? (
                          <div className={`flex justify-between font-bold text-base ${
                            perCapitaComputed <= LIMITE_RENDA_PER_CAPITA ? 'text-green-700' : 'text-red-700'
                          }`}>
                            <span>÷ {householdSize} pessoas = per capita{!ocrComplete ? ' *' : ''}</span>
                            <span className="tabular-nums">R$ {perCapitaComputed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-600 italic">
                            Aguardando OCR para calcular per capita
                          </p>
                        )}
                        {perCapitaComputed != null && !ocrComplete && (
                          <p className="text-xs text-amber-600 italic">
                            * Cálculo parcial: {validIncomeDocs.length} de {householdSize} membro(s) com comprovante — membros sem doc contam como R$ 0
                          </p>
                        )}
                        <div className="flex justify-between text-xs text-muted-foreground/70">
                          <span>Limite OCR permitido</span>
                          <span>R$ 6.072,00</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

              </div>

              {/* Right Column: Documents Viewer */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl h-full min-h-[600px] flex flex-col">
                  <CardHeader className="border-b bg-muted/30">
                    <CardTitle className="font-display">Documentos Enviados</CardTitle>
                    <CardDescription>{enrollment.documents?.length || 0} de 5 documentos obrigatórios enviados</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 flex-1 flex flex-col bg-secondary/10">
                    {enrollment.documents?.length > 0 ? (
                      <div className="grid grid-cols-1 divide-y">
                        {enrollment.documents.map((doc: any) => (
                          <div key={doc.id} className="p-6 hover:bg-white transition-colors flex flex-col md:flex-row gap-6">
                            <div className="w-full md:w-1/3 space-y-2 shrink-0">
                              <Badge className="uppercase tracking-wider text-xs mb-2">{doc.type}</Badge>
                              <h4 className="font-semibold truncate">{doc.name}</h4>
                              <p className="text-xs text-muted-foreground flex items-center">
                                <FileText className="w-3 h-3 mr-1" />
                                Enviado em {format(new Date(doc.uploadedAt), 'dd/MM')}
                              </p>
                              
                              {/* OCR Income Validation Display */}
                              <div className="mt-4 rounded-lg border border-border overflow-hidden">
                                <div className="bg-secondary/50 px-3 py-2 flex items-center gap-1.5">
                                  <BrainCircuit className="w-3.5 h-3.5 text-primary" />
                                  <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                                    Validação OCR
                                  </p>
                                </div>

                                {doc.ocrData ? (() => {
                                  const ocr = doc.ocrData as any;
                                  const statusStyles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
                                    APROVADO:       { bg: "bg-green-50",  text: "text-green-700",  icon: <ShieldCheck className="w-4 h-4" /> },
                                    REPROVADO:      { bg: "bg-red-50",    text: "text-red-700",    icon: <XCircle className="w-4 h-4" /> },
                                    REVISAO_MANUAL: { bg: "bg-amber-50",  text: "text-amber-700",  icon: <AlertCircle className="w-4 h-4" /> },
                                  };
                                  const style = statusStyles[ocr.status] ?? statusStyles.REVISAO_MANUAL;

                                  return (
                                    <div className="p-3 space-y-2">
                                      {/* Status pill */}
                                      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg ${style.bg}`}>
                                        <span className={style.text}>{style.icon}</span>
                                        <span className={`text-xs font-bold ${style.text}`}>
                                          {{ APROVADO: "Aprovado", REPROVADO: "Reprovado", REVISAO_MANUAL: "Revisão Manual" }[ocr.status as string] ?? ocr.status}
                                        </span>
                                        {ocr.ocrConfidence != null && (
                                          <span className="ml-auto text-xs text-muted-foreground">
                                            {ocr.ocrConfidence}% conf.
                                          </span>
                                        )}
                                      </div>

                                      {/* Monetary values */}
                                      {ocr.rendaTotal != null && (
                                        <div className="space-y-1 text-xs">
                                          {/* Valor selecionado como base */}
                                          {(ocr as any).valorSelecionado && (
                                            <div className="bg-muted/40 rounded p-1.5 space-y-0.5">
                                              <div className="flex items-center gap-1 text-muted-foreground">
                                                <span>Valor base:</span>
                                                <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                                  (ocr as any).valorSelecionado.priority === 1
                                                    ? "bg-green-100 text-green-700"
                                                    : (ocr as any).valorSelecionado.priority === 2
                                                    ? "bg-blue-100 text-blue-700"
                                                    : "bg-gray-100 text-gray-600"
                                                }`}>
                                                  {{ 1: "líquido", 2: "bruto", 3: "genérico" }[(ocr as any).valorSelecionado.priority as number]}
                                                </span>
                                              </div>
                                              <p className="truncate text-[10px] text-muted-foreground/70 italic" title={(ocr as any).valorSelecionado.label}>
                                                "{(ocr as any).valorSelecionado.label}"
                                              </p>
                                            </div>
                                          )}
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground flex items-center gap-1">
                                              <TrendingUp className="w-3 h-3" /> Renda extraída (este doc)
                                            </span>
                                            <span className="font-semibold tabular-nums">
                                              R$ {(ocr.rendaTotal as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                          {ocr.limitePermitido != null && (
                                            <div className="flex justify-between text-muted-foreground/70">
                                              <span>Limite permitido</span>
                                              <span className="tabular-nums">
                                                R$ {(ocr.limitePermitido as number).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      )}

                                      {/* Observation / motivo */}
                                      {(ocr.motivo || ocr.observacao) && (
                                        <p className="text-xs text-muted-foreground italic border-t border-border/40 pt-2">
                                          {ocr.motivo ?? ocr.observacao}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })() : (
                                  <p className="text-xs text-muted-foreground italic p-3">
                                    Nenhum dado extraído por OCR.
                                  </p>
                                )}
                              </div>
                            </div>
                            
                            <div className="w-full md:w-2/3 bg-black/5 rounded-xl border border-black/10 flex items-center justify-center min-h-[250px] overflow-hidden group relative">
                              {/* If URL contains data:image or data:application/pdf, render preview */}
                              {doc.url?.startsWith('data:image') ? (
                                <img src={doc.url} alt={doc.name} className="max-w-full max-h-full object-contain" />
                              ) : doc.url?.startsWith('data:application/pdf') ? (
                                <iframe src={doc.url} title={doc.name} className="w-full h-full min-h-[250px] border-0" />
                              ) : (
                                <div className="text-center text-muted-foreground">
                                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                  <p className="text-sm font-medium">Pré-visualização do Documento</p>
                                  <p className="text-xs">Clique para ver em tamanho completo</p>
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                <Button
                                  variant="secondary"
                                  className="rounded-xl font-bold shadow-xl"
                                  onClick={() => {
                                    if (!doc.url?.startsWith('data:')) return;
                                    const [header, b64] = doc.url.split(',');
                                    const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
                                    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                                    const blob = new Blob([bytes], { type: mime });
                                    const blobUrl = URL.createObjectURL(blob);
                                    window.open(blobUrl, '_blank');
                                  }}
                                >
                                  <Eye className="w-4 h-4 mr-2" /> Ver Documento Completo
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
                        <FileText className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-lg font-medium">Nenhum documento enviado ainda</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
