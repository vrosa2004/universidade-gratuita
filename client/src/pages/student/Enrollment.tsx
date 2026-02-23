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
import { Loader2, CheckCircle2, Upload, File, ShieldCheck, Send } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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

  const [activeTab, setActiveTab] = useState<'personal' | 'documents' | 'files'>('personal');
  
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
      if (enrollment.name && activeTab === 'personal') {
        setActiveTab('documents');
      }
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
      setActiveTab('documents');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Erro ao salvar dados", description: e.message });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: any) => {
    const file = e.target.files?.[0];
    if (!file || !enrollment) return;

    // Simulate convert to base64
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

  // Don't allow editing if not pending
  if (enrollment && enrollment.status !== 'pending') {
    setLocation('/student');
    return null;
  }

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

        {/* Custom Tabs */}
        <div className="flex space-x-2 mb-8 p-1 bg-muted/50 rounded-xl w-fit border">
          <button 
            onClick={() => setActiveTab('personal')}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'personal' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            1. Dados Pessoais
          </button>
          <button 
            onClick={() => {
              if (enrollment) setActiveTab('documents');
              else toast({ title: "Salve os dados pessoais primeiro", variant: "destructive" });
            }}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'documents' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'} ${!enrollment && 'opacity-50 cursor-not-allowed'}`}
          >
            2. Lista de Documentos
          </button>
          <button 
            onClick={() => {
              if (enrollment) setActiveTab('files');
              else toast({ title: "Salve os dados pessoais primeiro", variant: "destructive" });
            }}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeTab === 'files' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'} ${!enrollment && 'opacity-50 cursor-not-allowed'}`}
          >
            3. Anexar Arquivos
          </button>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'personal' && (
            <motion.div
              key="personal"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
            >
              <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
                <CardHeader className="pb-4 border-b border-border/50">
                  <CardTitle className="font-display flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Informações Pessoais
                  </CardTitle>
                  <CardDescription>Precisamos destes detalhes para verificar sua elegibilidade.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6 pt-6 p-6 md:p-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome Completo</Label>
                      <Input id="name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" placeholder="João Silva" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cpf">CPF</Label>
                      <Input id="cpf" value={formData.cpf} onChange={(e) => setFormData({...formData, cpf: e.target.value})} className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" placeholder="000.000.000-00" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dob">Data de Nascimento</Label>
                      <Input id="dob" type="date" value={formData.dateOfBirth} onChange={(e) => setFormData({...formData, dateOfBirth: e.target.value})} className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="income">Renda Mensal (R$)</Label>
                      <Input id="income" type="number" value={formData.income} onChange={(e) => setFormData({...formData, income: e.target.value})} className="h-12 rounded-xl bg-background border-border focus:ring-primary/20" placeholder="Ex: 1500" />
                    </div>
                  </div>
                  
                  <div className="pt-4 flex justify-end">
                    <Button 
                      onClick={handleSavePersonal} 
                      disabled={isSaving || !formData.name || !formData.cpf}
                      className="h-12 px-8 rounded-xl font-semibold shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                    >
                      {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Salvar e Continuar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeTab === 'documents' && enrollment && (
            <motion.div
              key="documents"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl">
                <CardHeader className="pb-4 border-b border-border/50">
                  <CardTitle className="font-display flex items-center gap-2">
                    <File className="h-5 w-5 text-primary" />
                    Status dos Documentos
                  </CardTitle>
                  <CardDescription>Verifique quais documentos já foram enviados.</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {DOCUMENT_TYPES.map((doc) => {
                      const isUploaded = uploadedTypes.includes(doc.id);
                      return (
                        <div key={doc.id} className={`p-4 rounded-xl border flex items-center justify-between ${isUploaded ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border'}`}>
                          <div className="flex items-center gap-3">
                            {isUploaded ? <CheckCircle2 className="w-5 h-5 text-primary" /> : <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30" />}
                            <div>
                              <p className="text-sm font-semibold">{doc.label}</p>
                              <p className="text-xs text-muted-foreground">{isUploaded ? 'Enviado' : 'Pendente'}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => setActiveTab('files')}>
                            Ver
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-8 flex justify-end">
                    <Button onClick={() => setActiveTab('files')} className="h-12 rounded-xl">
                      Ir para Anexos
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {activeTab === 'files' && enrollment && (
            <motion.div
              key="files"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {DOCUMENT_TYPES.map((doc) => {
                  const isUploaded = uploadedTypes.includes(doc.id);
                  const isUploading = uploadMutation.isPending && uploadMutation.variables?.data.type === doc.id;

                  return (
                    <Card key={doc.id} className={`border border-border/50 shadow-md rounded-xl overflow-hidden transition-all ${isUploaded ? 'bg-primary/5 border-primary/20' : 'bg-card hover:border-primary/30'}`}>
                      <div className="p-5 flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${isUploaded ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                          {isUploaded ? <CheckCircle2 className="w-6 h-6" /> : <File className="w-6 h-6" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-foreground truncate">{doc.label}</h4>
                          <p className="text-xs text-muted-foreground truncate">{doc.desc}</p>
                        </div>
                        <div>
                          <Label 
                            htmlFor={`file-${doc.id}`}
                            className={`cursor-pointer inline-flex items-center justify-center h-10 px-4 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${isUploaded ? 'bg-background border border-border hover:bg-secondary text-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'}`}
                          >
                            {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : 
                             isUploaded ? 'Substituir' : <><Upload className="w-4 h-4 mr-2" /> Enviar</>}
                          </Label>
                          <Input 
                            id={`file-${doc.id}`} 
                            type="file" 
                            className="hidden" 
                            onChange={(e) => handleFileUpload(e, doc.id)}
                            accept="image/*,.pdf"
                            disabled={uploadMutation.isPending}
                          />
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>

              <Card className="border-0 shadow-xl shadow-primary/10 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground overflow-hidden mt-8">
                <CardContent className="p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                  <div>
                    <h3 className="font-display text-2xl font-bold mb-2">Tudo pronto?</h3>
                    <p className="text-primary-foreground/80 max-w-md">
                      Certifique-se de que todos os dados estão corretos e os documentos estão legíveis. Após o envio, você não poderá alterá-los enquanto estiverem em análise.
                    </p>
                  </div>
                  <Button 
                    onClick={handleSubmitFinal}
                    disabled={!canSubmit || submitMutation.isPending}
                    className="h-14 px-8 rounded-xl bg-white text-primary hover:bg-white/90 hover:scale-105 transition-all font-bold text-lg whitespace-nowrap shadow-xl"
                  >
                    {submitMutation.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
                    Finalizar Inscrição
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}