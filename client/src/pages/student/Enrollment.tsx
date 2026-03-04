import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { StudentNavbar } from "@/components/layout/StudentNavbar";
import { useMyEnrollment, useCreateEnrollment, useUpdateEnrollment, useSubmitEnrollment } from "@/hooks/use-enrollments";
import { useUploadDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useRequiredAttachments } from "@/hooks/use-attachments";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, Upload, File, ShieldCheck, Send,
  AlertCircle, Info, HelpCircle, Lock, Plus, Trash2, FileText
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { INCOME_CATEGORIES } from "@shared/attachments";
import type { AttachmentContext, AttachmentDescriptor } from "@shared/attachments";

// ── Types ────────────────────────────────────────────────────────────────────

type IncomeCategoryKey = keyof typeof INCOME_CATEGORIES;

interface FormData {
  name: string;
  cpf: string;
  dateOfBirth: string;
  income: string;
  householdSize: string;
  monthlyExpenses: string;
  incomeCategory: IncomeCategoryKey | '';
  hasFormalEmploymentHistory: boolean | null;
  hasVariableIncome: boolean | null;
  isCompanyActive: boolean | null;
  hasProLabore: boolean | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONDITIONAL_FIELDS: Partial<Record<IncomeCategoryKey, {
  field: keyof Pick<FormData, 'hasFormalEmploymentHistory' | 'hasVariableIncome' | 'isCompanyActive' | 'hasProLabore'>;
  question: string;
}[]>> = {
  unemployed: [
    { field: 'hasFormalEmploymentHistory', question: 'Teve vínculo empregatício formal nos últimos 2 anos?' },
  ],
  salaried: [
    { field: 'hasVariableIncome', question: 'Recebe comissões ou horas extras (renda variável)?' },
  ],
  business_owner: [
    { field: 'isCompanyActive', question: 'A empresa está ativa atualmente?' },
    { field: 'hasProLabore', question: 'Realiza retirada de pró-labore?' },
  ],
};

function triBoolean(val: boolean | null): 'yes' | 'no' | '' {
  if (val === true) return 'yes';
  if (val === false) return 'no';
  return '';
}

function fromTriBoolean(val: string): boolean | null {
  if (val === 'yes') return true;
  if (val === 'no') return false;
  return null;
}

function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function validateCpf(cpf: string): boolean {
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  if (rem !== parseInt(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  rem = (sum * 10) % 11;
  if (rem === 10 || rem === 11) rem = 0;
  return rem === parseInt(digits[10]);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function StudentEnrollment() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: enrollment, isLoading: isFetching } = useMyEnrollment();
  const createMutation = useCreateEnrollment();
  const updateMutation = useUpdateEnrollment();
  const submitMutation = useSubmitEnrollment();
  const uploadMutation = useUploadDocument();
  const deleteMutation = useDeleteDocument();

  const [editingDoc, setEditingDoc] = useState<AttachmentDescriptor | null>(null);
  const [cpfError, setCpfError] = useState<string>('');

  const [formData, setFormData] = useState<FormData>({
    name: '',
    cpf: '',
    dateOfBirth: '',
    income: '',
    householdSize: '',
    monthlyExpenses: '',
    incomeCategory: '',
    hasFormalEmploymentHistory: null,
    hasVariableIncome: null,
    isCompanyActive: null,
    hasProLabore: null,
  });

  useEffect(() => {
    if (enrollment) {
      setFormData({
        name: enrollment.name || '',
        cpf: enrollment.cpf || '',
        dateOfBirth: enrollment.dateOfBirth || '',
        income: enrollment.income?.toString() || '',
        householdSize: enrollment.householdSize?.toString() || '',
        monthlyExpenses: enrollment.monthlyExpenses?.toString() || '',
        incomeCategory: (enrollment.incomeCategory as IncomeCategoryKey) || '',
        hasFormalEmploymentHistory: enrollment.hasFormalEmploymentHistory ?? null,
        hasVariableIncome: enrollment.hasVariableIncome ?? null,
        isCompanyActive: enrollment.isCompanyActive ?? null,
        hasProLabore: enrollment.hasProLabore ?? null,
      });
    }
  }, [enrollment]);

  const attachmentCtx: Partial<AttachmentContext> | null = useMemo(() => {
    if (!formData.incomeCategory) return null;
    return {
      incomeCategory: formData.incomeCategory as IncomeCategoryKey,
      income: parseInt(formData.income) || 0,
      monthlyExpenses: parseInt(formData.monthlyExpenses) || 0,
      householdSize: parseInt(formData.householdSize) || 1,
      hasFormalEmploymentHistory: formData.hasFormalEmploymentHistory ?? undefined,
      hasVariableIncome: formData.hasVariableIncome ?? undefined,
      isCompanyActive: formData.isCompanyActive ?? undefined,
      hasProLabore: formData.hasProLabore ?? undefined,
    };
  }, [formData]);

  const { data: requiredAttachments = [], isLoading: isLoadingAttachments } = useRequiredAttachments(attachmentCtx);

  const handleSavePersonal = async () => {
    try {
      const payload: Record<string, unknown> = {
        name: formData.name,
        cpf: formData.cpf,
        dateOfBirth: formData.dateOfBirth,
        income: formData.income ? parseInt(formData.income) : undefined,
        householdSize: formData.householdSize ? parseInt(formData.householdSize) : undefined,
        monthlyExpenses: formData.monthlyExpenses ? parseInt(formData.monthlyExpenses) : undefined,
        incomeCategory: formData.incomeCategory || undefined,
        hasFormalEmploymentHistory: formData.hasFormalEmploymentHistory,
        hasVariableIncome: formData.hasVariableIncome,
        isCompanyActive: formData.isCompanyActive,
        hasProLabore: formData.hasProLabore,
      };
      if (enrollment) {
        await updateMutation.mutateAsync({ id: enrollment.id, data: payload as any });
        toast({ title: "Dados salvos com sucesso!" });
      } else {
        await createMutation.mutateAsync({ studentId: user!.id, ...payload } as any);
        toast({ title: "Inscrição iniciada com sucesso!" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao salvar dados", description: e.message });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !enrollment) return;
    // reset the input so the same file can be re-selected later
    e.target.value = '';

    let uploaded = 0;
    for (const file of files) {
      const base64Content: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      try {
        await uploadMutation.mutateAsync({
          id: enrollment.id,
          data: { type: type as any, name: file.name, base64Content },
        });
        uploaded++;
      } catch (err: any) {
        toast({ variant: "destructive", title: `Falha ao enviar "${file.name}"`, description: err.message });
      }
    }
    if (uploaded > 0) {
      toast({ title: uploaded === 1 ? "Documento enviado!" : `${uploaded} documentos enviados!` });
    }
    if (uploaded === files.length) setEditingDoc(null);
  };

  const handleDeleteDoc = async (docId: number) => {
    try {
      await deleteMutation.mutateAsync(docId);
      toast({ title: "Arquivo removido." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Falha ao remover", description: err.message });
    }
  };

  const handleSubmitFinal = async () => {
    if (!enrollment) return;
    try {
      await submitMutation.mutateAsync(enrollment.id);
      toast({ title: "Inscrição enviada!", description: "Sua inscrição está em análise." });
      setLocation('/student');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Não foi possível enviar", description: e.message });
    }
  };

  if (isFetching) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-primary w-8 h-8" />
      </div>
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const allDocs: any[] = enrollment?.documents ?? [];
  const uploadedTypes: string[] = allDocs.map((d) => d.type);
  const isFinalized = enrollment?.status === 'approved' || enrollment?.status === 'rejected';
  const isLocked = !!(enrollment && enrollment.status !== 'pending');

  const isPayslip3Mode = formData.incomeCategory === 'salaried' && formData.hasVariableIncome === false;
  const numOutrosMembros = Math.max(0, (parseInt(formData.householdSize) || 1) - 1);

  const missingRequired: AttachmentDescriptor[] = useMemo(() => {
    const requiredList = requiredAttachments.filter((a) => a.required);
    const satisfiedGroups = new Set<string>();
    const missing: AttachmentDescriptor[] = [];
    for (const att of requiredList) {
      // income_proof in payslip-3 mode is always optional — never blocks submit
      if (att.key === 'income_proof' && isPayslip3Mode) continue;
      const typeDocs = allDocs.filter((d) => d.type === att.key);
      let uploaded: boolean;
      if (att.key === 'payslip_3') {
        uploaded = typeDocs.length >= 3;
      } else {
        uploaded = typeDocs.length > 0;
      }
      if (att.group) {
        if (uploaded) { satisfiedGroups.add(att.group); continue; }
        if (satisfiedGroups.has(att.group)) continue;
        const groupOk = requiredList.filter(a => a.group === att.group).some(a => {
          const docs = allDocs.filter(d => d.type === a.key);
          return a.key === 'payslip_3' ? docs.length >= 3 : docs.length > 0;
        });
        if (groupOk) { satisfiedGroups.add(att.group); continue; }
        if (!missing.some(m => m.group === att.group)) missing.push(att);
      } else if (!uploaded) {
        missing.push(att);
      }
    }
    return missing;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredAttachments, uploadedTypes, isPayslip3Mode, numOutrosMembros]);

  const canSubmit =
    !!enrollment?.name && !!enrollment?.cpf &&
    !!enrollment?.incomeCategory &&
    missingRequired.length === 0 && !isFinalized;

  return (
    <div className="min-h-screen bg-secondary/30 pb-20">
      <StudentNavbar />

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Minha Inscrição</h1>
          <p className="text-muted-foreground mt-1">Preencha seus dados e envie os documentos exigidos pelo Programa Universidade Gratuita.</p>
        </div>

        {/* 1. Dados Pessoais & Categoria */}
        <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
          <CardHeader className="pb-4 border-b border-border/50">
            <CardTitle className="font-display flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              1. Informações Pessoais e Renda
            </CardTitle>
            <CardDescription>Dados usados para verificar elegibilidade e gerar a lista de anexos obrigatórios.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-6 p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name">Nome Completo</Label>
                <Input id="name" value={formData.name} disabled={isLocked}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-12 rounded-xl" placeholder="João Silva" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpf">CPF</Label>
                <Input id="cpf" value={formData.cpf} disabled={isLocked}
                  onChange={(e) => {
                    const masked = maskCpf(e.target.value);
                    setFormData({ ...formData, cpf: masked });
                    if (masked.length === 14) {
                      setCpfError(validateCpf(masked) ? '' : 'CPF inválido');
                    } else {
                      setCpfError('');
                    }
                  }}
                  onBlur={() => {
                    if (formData.cpf && !validateCpf(formData.cpf)) {
                      setCpfError('CPF inválido');
                    }
                  }}
                  inputMode="numeric"
                  className={`h-12 rounded-xl ${cpfError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  placeholder="000.000.000-00" />
                {cpfError && <p className="text-xs text-destructive">{cpfError}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Data de Nascimento</Label>
                <Input id="dob" type="date" value={formData.dateOfBirth} disabled={isLocked}
                  onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                  className="h-12 rounded-xl" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="income">Renda Familiar Bruta Mensal (R$)</Label>
                <Input id="income" type="number" value={formData.income} disabled={isLocked}
                  onChange={(e) => setFormData({ ...formData, income: e.target.value })}
                  className="h-12 rounded-xl" placeholder="Ex: 1500" />
                {formData.incomeCategory !== 'salaried' && formData.income && formData.householdSize && parseInt(formData.householdSize) > 1 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Renda total familiar estimada:{' '}
                    <span className="font-semibold text-foreground">
                      R$ {(parseInt(formData.income) * parseInt(formData.householdSize)).toLocaleString('pt-BR')}
                    </span>
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="householdSize">Nº de pessoas na residência</Label>
                <Input id="householdSize" type="number" min="1" value={formData.householdSize} disabled={isLocked}
                  onChange={(e) => setFormData({ ...formData, householdSize: e.target.value })}
                  className="h-12 rounded-xl" placeholder="Ex: 4" />
                {formData.incomeCategory !== 'salaried' && formData.income && formData.householdSize && parseInt(formData.householdSize) > 0 && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Renda per capita:{' '}
                    <span className="font-semibold text-foreground">
                      R$ {Math.round(parseInt(formData.income) / parseInt(formData.householdSize)).toLocaleString('pt-BR')}
                    </span>
                    {' '}/ pessoa
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="expenses">
                  Despesas Mensais Totais (R$)
                  <span className="ml-1 text-xs text-muted-foreground">(incluindo mensalidade)</span>
                </Label>
                <Input id="expenses" type="number" value={formData.monthlyExpenses} disabled={isLocked}
                  onChange={(e) => setFormData({ ...formData, monthlyExpenses: e.target.value })}
                  className="h-12 rounded-xl" placeholder="Ex: 1800" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="incomeCategory">Categoria de Renda</Label>
                <Select
                  value={formData.incomeCategory}
                  disabled={isLocked}
                  onValueChange={(val) =>
                    setFormData({
                      ...formData,
                      incomeCategory: val as IncomeCategoryKey,
                      hasFormalEmploymentHistory: null,
                      hasVariableIncome: null,
                      isCompanyActive: null,
                      hasProLabore: null,
                    })
                  }
                >
                  <SelectTrigger className="h-12 rounded-xl">
                    <SelectValue placeholder="Selecione sua situação trabalhista..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(INCOME_CATEGORIES) as IncomeCategoryKey[]).map((key) => (
                      <SelectItem key={key} value={key}>{INCOME_CATEGORIES[key]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Conditional boolean questions */}
            {formData.incomeCategory && CONDITIONAL_FIELDS[formData.incomeCategory] && (
              <div className="pt-2 space-y-4 border-t border-border/40">
                <p className="text-sm font-semibold text-muted-foreground">Informações complementares</p>
                {CONDITIONAL_FIELDS[formData.incomeCategory]!.map(({ field, question }) => (
                  <div key={field} className="space-y-2">
                    <Label>{question}</Label>
                    <div className="flex gap-3">
                      {(['yes', 'no'] as const).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={isLocked}
                          onClick={() => setFormData({ ...formData, [field]: fromTriBoolean(opt) })}
                          className={`h-10 px-5 rounded-xl border text-sm font-medium transition-all ${
                            triBoolean(formData[field]) === opt
                              ? 'bg-primary text-primary-foreground border-primary shadow-md'
                              : 'bg-background border-border hover:border-primary/50'
                          }`}
                        >
                          {opt === 'yes' ? 'Sim' : 'Não'}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Renda < Despesas warning */}
            {formData.income && formData.monthlyExpenses &&
              parseInt(formData.income) < parseInt(formData.monthlyExpenses) && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertTitle className="text-amber-800">Renda abaixo das despesas</AlertTitle>
                <AlertDescription>
                  O documento <strong>Justificativa de Renda e Gastos</strong> será exigido automaticamente.
                </AlertDescription>
              </Alert>
            )}

            <div className="pt-4 flex justify-end">
              <Button
                onClick={handleSavePersonal}
                disabled={isSaving || !formData.name || !formData.cpf || !validateCpf(formData.cpf) || isLocked}
                className="h-12 px-8 rounded-xl font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all"
              >
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {enrollment ? 'Atualizar Dados' : 'Iniciar Inscrição'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 2. Checklist de Documentos */}
        {enrollment && (
          <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="font-display flex items-center gap-2">
                <File className="h-5 w-5 text-primary" />
                2. Documentos e Anexos
              </CardTitle>
              <CardDescription>
                {formData.incomeCategory
                  ? `Lista gerada automaticamente para: ${INCOME_CATEGORIES[formData.incomeCategory]}`
                  : 'Selecione sua categoria de renda acima para ver os documentos exigidos.'}
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6 p-6 space-y-6">
              {!formData.incomeCategory && (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-3">
                  <HelpCircle className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Selecione a <strong>Categoria de Renda</strong> na seção acima para gerar automaticamente os documentos obrigatórios.</p>
                </div>
              )}

              {formData.incomeCategory && isLoadingAttachments && (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                  <Loader2 className="animate-spin h-5 w-5" />
                  <span className="text-sm">Gerando lista de documentos...</span>
                </div>
              )}

              {formData.incomeCategory && !isLoadingAttachments && requiredAttachments.length > 0 && (
                <>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-destructive/70 inline-block" /> Obrigatório pendente
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary inline-block" /> Enviado
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" /> Condicional
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {requiredAttachments.map((att) => {
                      const typeDocs = allDocs.filter((d) => d.type === att.key);
                      // payslip_3 requires exactly 3 files; treat as complete only when 3 are uploaded
                      const isPayslip3 = att.key === 'payslip_3';
                      const isIncomeProofFamilia = att.key === 'income_proof' && isPayslip3Mode && numOutrosMembros > 0;
                      const isUploaded = isPayslip3
                        ? typeDocs.length >= 3
                        : isIncomeProofFamilia
                        ? typeDocs.length >= numOutrosMembros
                        : typeDocs.length > 0;
                      return (
                        <div
                          key={att.key}
                          className={`rounded-xl border transition-all ${
                            isUploaded
                              ? 'bg-primary/5 border-primary/20 shadow-sm'
                              : att.required
                              ? 'bg-destructive/5 border-destructive/20 border-dashed'
                              : 'bg-amber-50/50 border-amber-200 border-dashed'
                          }`}
                        >
                          {/* Row header */}
                          <div className="flex items-center gap-3 p-4">
                            <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center ${
                              isUploaded ? 'bg-primary text-primary-foreground'
                              : att.required ? 'bg-destructive/10 text-destructive'
                              : 'bg-amber-100 text-amber-700'
                            }`}>
                              {isUploaded ? <CheckCircle2 className="w-5 h-5" /> : att.required ? <AlertCircle className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold">{att.label}</p>
                                {att.required
                                  ? <Badge variant="destructive" className="text-[10px] h-4 px-1.5">Obrigatório</Badge>
                                  : <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-400 text-amber-700">Condicional</Badge>}
                                {att.group && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Alternativo</Badge>}
                                {isPayslip3 && (
                                  <Badge
                                    variant={isUploaded ? 'default' : 'outline'}
                                    className={`text-[10px] h-4 px-1.5 ${isUploaded ? 'bg-green-600' : typeDocs.length > 0 ? 'border-amber-400 text-amber-700' : ''}`}
                                  >
                                    {typeDocs.length}/3 enviados
                                  </Badge>
                                )}
                                {isIncomeProofFamilia && (
                                  <Badge
                                    variant={isUploaded ? 'default' : 'outline'}
                                    className={`text-[10px] h-4 px-1.5 ${isUploaded ? 'bg-green-600' : typeDocs.length > 0 ? 'border-amber-400 text-amber-700' : ''}`}
                                  >
                                    {typeDocs.length}/{numOutrosMembros} familiar(es)
                                  </Badge>
                                )}
                              </div>
                              {att.condition && <p className="text-xs text-muted-foreground mt-0.5 italic">{att.condition}</p>}
                              {isPayslip3 && !isUploaded && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {typeDocs.length === 0
                                    ? 'Envie os 3 contracheques dos últimos 3 meses. A média salarial será calculada automaticamente.'
                                    : `${typeDocs.length}/3 enviados. Ainda faltam ${3 - typeDocs.length} contracheque(s).`}
                                </p>
                              )}
                              {isPayslip3 && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                                  <strong>Atenção:</strong> não inclua seu próprio salário no campo de renda familiar. Seu salário será calculado automaticamente com base na média dos 3 contracheques enviados.
                                </p>
                              )}
                              {isIncomeProofFamilia && !isUploaded && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {typeDocs.length === 0
                                    ? `Envie ${numOutrosMembros} comprovante(s) de renda — um para cada familiar que mora com você (excluindo você).`
                                    : `${typeDocs.length}/${numOutrosMembros} enviado(s). Ainda faltam ${numOutrosMembros - typeDocs.length} comprovante(s).`}
                                </p>
                              )}
                              {!isPayslip3 && !isIncomeProofFamilia && !isUploaded && <p className="text-xs text-muted-foreground mt-0.5">Nenhum arquivo enviado</p>}
                            </div>
                            {!isFinalized ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-lg h-8 px-3 shrink-0 text-xs gap-1.5"
                                onClick={() => setEditingDoc(att)}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Adicionar
                              </Button>
                            ) : (
                              <Lock className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                            )}
                          </div>

                          {/* Uploaded files list */}
                          {typeDocs.length > 0 && (
                            <div className="border-t border-border/20 px-4 pb-3 pt-2 flex flex-col gap-1.5">
                              {typeDocs.map((doc) => (
                                <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-background/60 border border-border/40 px-3 py-2">
                                  <FileText className="h-4 w-4 text-primary shrink-0" />
                                  <span className="text-xs font-medium flex-1 truncate">{doc.name}</span>
                                  {!isFinalized && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 rounded-md text-muted-foreground hover:text-destructive shrink-0"
                                      onClick={() => handleDeleteDoc(doc.id)}
                                      disabled={deleteMutation.isPending}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {missingRequired.length > 0 && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Documentos obrigatórios ausentes</AlertTitle>
                      <AlertDescription>
                        <ul className="mt-1 list-disc list-inside space-y-0.5">
                          {missingRequired.map((m) => <li key={m.key} className="text-sm">{m.label}</li>)}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              {/* Submit panel */}
              <div className="mt-4 pt-6 border-t">
                <div className={`flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl shadow-lg ${
                  canSubmit ? 'bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-primary/20' : 'bg-muted'
                }`}>
                  <div className="text-center md:text-left">
                    <h3 className={`font-display text-xl font-bold mb-1 ${canSubmit ? '' : 'text-foreground'}`}>Finalizar Inscrição</h3>
                    <p className={`text-sm max-w-sm ${canSubmit ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {isFinalized
                        ? 'Inscrição já finalizada. Aguarde o resultado da análise.'
                        : canSubmit
                        ? 'Todos os documentos obrigatórios foram enviados. Clique para finalizar.'
                        : 'Envie todos os documentos obrigatórios para liberar o botão de envio.'}
                    </p>
                  </div>
                  <Button
                    onClick={handleSubmitFinal}
                    disabled={!canSubmit || submitMutation.isPending}
                    className={`h-12 px-8 rounded-xl font-bold shadow-xl shrink-0 ${canSubmit ? 'bg-white text-primary hover:bg-white/90' : ''}`}
                  >
                    {submitMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                    Enviar Agora
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Upload Dialog */}
      <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              {editingDoc?.label}
            </DialogTitle>
            <DialogDescription>
              {editingDoc?.required
                ? 'Documento obrigatório. Selecione o arquivo para envio.'
                : `Documento condicional: ${editingDoc?.condition}`}
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <div className="border-2 border-dashed border-muted-foreground/20 rounded-2xl p-8 text-center bg-muted/30 hover:bg-muted/50 transition-colors group">
              <Label htmlFor="modal-file-upload" className="cursor-pointer flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                  {uploadMutation.isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">Clique para selecionar</p>
                  <p className="text-xs text-muted-foreground mt-1">Imagens ou PDF • Múltiplos arquivos permitidos</p>
                </div>
              </Label>
              <Input
                id="modal-file-upload"
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e, editingDoc?.key ?? '')}
                accept="image/*,.pdf"
                disabled={uploadMutation.isPending}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
