import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { StudentNavbar } from "@/components/layout/StudentNavbar";
import { useMyEnrollment, useCreateEnrollment, useUpdateEnrollment, useSubmitEnrollment } from "@/hooks/use-enrollments";
import { useUploadDocument } from "@/hooks/use-documents";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Upload, File, ShieldCheck, Send, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DOCUMENT_TYPES = [
  { id: 'rg', label: 'Identity Card (RG)', desc: 'Front and back of your ID' },
  { id: 'cpf', label: 'CPF Document', desc: 'Official CPF card or digital copy' },
  { id: 'residence', label: 'Proof of Residence', desc: 'Utility bill from the last 3 months' },
  { id: 'transcript', label: 'School Transcript', desc: 'High school completion records' },
  { id: 'income', label: 'Proof of Income', desc: 'Recent paycheck or tax return' },
] as const;

export default function StudentEnrollment() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const { data: enrollment, isLoading: isFetching } = useMyEnrollment();
  const createMutation = useCreateEnrollment();
  const updateMutation = useUpdateEnrollment();
  const submitMutation = useSubmitEnrollment();
  const uploadMutation = useUploadDocument();

  const [activeTab, setActiveTab] = useState<'personal' | 'documents'>('personal');
  const [editingDoc, setEditingDoc] = useState<typeof DOCUMENT_TYPES[number] | null>(null);
  
  // Form State
  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    dateOfBirth: '',
    income: '',
  });

  // Init form
  useEffect(() => {
    if (enrollment) {
      setFormData({
        name: enrollment.name || '',
        cpf: enrollment.cpf || '',
        dateOfBirth: enrollment.dateOfBirth || '',
        income: enrollment.income?.toString() || '',
      });
    }
  }, [enrollment]);

  const handleSavePersonal = async () => {
    try {
      const payload = {
        ...formData,
        income: formData.income ? parseInt(formData.income) : undefined,
      };

      if (enrollment) {
        await updateMutation.mutateAsync({ id: enrollment.id, data: payload });
        toast({ title: "Dados pessoais atualizados!" });
      } else {
        await createMutation.mutateAsync({ studentId: user!.id, ...payload });
        toast({ title: "Inscrição iniciada com sucesso!" });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao salvar dados", description: e.message });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: any) => {
    const file = e.target.files?.[0];
    if (!file || !enrollment) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        await uploadMutation.mutateAsync({
          id: enrollment.id,
          data: {
            type,
            name: file.name,
            base64Content: reader.result as string
          }
        });
        toast({ title: `${DOCUMENT_TYPES.find(d => d.id === type)?.label} enviado com sucesso!` });
        setEditingDoc(null);
      } catch (err: any) {
        toast({ variant: "destructive", title: "Falha no envio", description: err.message });
      }
    };
  };

  const handleSubmitFinal = async () => {
    if (!enrollment) return;
    try {
      await submitMutation.mutateAsync(enrollment.id);
      toast({ title: "Inscrição enviada com sucesso!", description: "Sua inscrição está em análise." });
      setLocation('/student');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Não foi possível enviar", description: e.message });
    }
  };

  if (isFetching) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary w-8 h-8"/></div>;

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const uploadedTypes = enrollment?.documents?.map((d: any) => d.type) || [];
  const allDocsUploaded = DOCUMENT_TYPES.every(d => uploadedTypes.includes(d.id));
  const canSubmit = enrollment?.name && enrollment?.cpf && allDocsUploaded;

  return (
    <div className="min-h-screen bg-secondary/30 pb-20">
      <StudentNavbar />
      
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground">Minha Inscrição</h1>
          <p className="text-muted-foreground mt-1">Complete seu perfil e envie os documentos obrigatórios</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-1 gap-8">
          {/* Section 1: Dados Pessoais */}
          <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
            <CardHeader className="pb-4 border-b border-border/50">
              <CardTitle className="font-display flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                1. Informações Pessoais
              </CardTitle>
              <CardDescription>Precisamos destes detalhes para verificar sua elegibilidade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6 p-6 md:p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Nome Completo</Label>
                  <Input 
                    id="name" 
                    value={formData.name} 
                    onChange={(e) => setFormData({...formData, name: e.target.value})} 
                    disabled={enrollment && enrollment.status !== 'pending'}
                    className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" 
                    placeholder="João Silva" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cpf">CPF</Label>
                  <Input 
                    id="cpf" 
                    value={formData.cpf} 
                    onChange={(e) => setFormData({...formData, cpf: e.target.value})} 
                    disabled={enrollment && enrollment.status !== 'pending'}
                    className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" 
                    placeholder="000.000.000-00" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dob">Data de Nascimento</Label>
                  <Input 
                    id="dob" 
                    type="date" 
                    value={formData.dateOfBirth} 
                    onChange={(e) => setFormData({...formData, dateOfBirth: e.target.value})} 
                    disabled={enrollment && enrollment.status !== 'pending'}
                    className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="income">Renda Mensal (R$)</Label>
                  <Input 
                    id="income" 
                    type="number" 
                    value={formData.income} 
                    onChange={(e) => setFormData({...formData, income: e.target.value})} 
                    disabled={enrollment && enrollment.status !== 'pending'}
                    className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" 
                    placeholder="Ex: 1500" 
                  />
                </div>
              </div>
              
              <div className="pt-4 flex justify-end">
                <Button 
                  onClick={handleSavePersonal} 
                  disabled={isSaving || !formData.name || !formData.cpf || (enrollment && enrollment.status !== 'pending')}
                  className="h-12 px-8 rounded-xl font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                >
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {enrollment ? 'Atualizar Dados' : 'Iniciar Inscrição'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Section 2: Documentos */}
          {enrollment && (
            <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
              <CardHeader className="pb-4 border-b border-border/50">
                <CardTitle className="font-display flex items-center gap-2">
                  <File className="h-5 w-5 text-primary" />
                  2. Documentos e Anexos
                </CardTitle>
                <CardDescription>Gerencie seus documentos obrigatórios.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {DOCUMENT_TYPES.map((doc) => {
                    const isUploaded = uploadedTypes.includes(doc.id);
                    const docData = enrollment.documents?.find((d: any) => d.type === doc.id);
                    
                    return (
                      <div key={doc.id} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${isUploaded ? 'bg-primary/5 border-primary/20 shadow-sm' : 'bg-muted/30 border-border border-dashed'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isUploaded ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                            {isUploaded ? <CheckCircle2 className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{doc.label}</p>
                            <p className="text-xs text-muted-foreground truncate">{isUploaded ? docData?.name : 'Pendente'}</p>
                          </div>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="rounded-lg h-9 w-9 p-0"
                          onClick={() => setEditingDoc(doc)}
                        >
                          {isUploaded ? <Pencil className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                        </Button>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-10 pt-6 border-t">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-6 p-6 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/20">
                    <div className="text-center md:text-left">
                      <h3 className="font-display text-xl font-bold mb-1">Finalizar Inscrição</h3>
                      <p className="text-primary-foreground/80 text-sm max-w-sm">
                        Após o envio, os dados pessoais serão bloqueados para análise. Você poderá atualizar anexos se necessário.
                      </p>
                    </div>
                    <Button 
                      onClick={handleSubmitFinal}
                      disabled={!canSubmit || submitMutation.isPending || (enrollment && enrollment.status !== 'pending')}
                      className="h-12 px-8 rounded-xl bg-white text-primary hover:bg-white/90 font-bold shadow-xl shrink-0"
                    >
                      {submitMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                      Enviar Agora
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Upload Modal */}
        <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-primary" />
                {editingDoc?.label}
              </DialogTitle>
              <DialogDescription>
                Selecione o arquivo para envio. {editingDoc?.desc}
              </DialogDescription>
            </DialogHeader>
            <div className="py-6">
              <div className="border-2 border-dashed border-muted-foreground/20 rounded-2xl p-8 text-center bg-muted/30 hover:bg-muted/50 transition-colors group">
                <Label 
                  htmlFor="modal-file-upload" 
                  className="cursor-pointer flex flex-col items-center gap-4"
                >
                  <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center group-hover:scale-110 transition-transform">
                    {uploadMutation.isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : <Upload className="h-8 w-8" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Clique para selecionar</p>
                    <p className="text-xs text-muted-foreground mt-1">Imagens ou PDF até 10MB</p>
                  </div>
                </Label>
                <Input 
                  id="modal-file-upload" 
                  type="file" 
                  className="hidden" 
                  onChange={(e) => handleFileUpload(e, editingDoc?.id)}
                  accept="image/*,.pdf"
                  disabled={uploadMutation.isPending}
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}