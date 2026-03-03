import { useState } from "react";
import { motion } from "framer-motion";
import { ShieldPlus, Loader2, UserCheck } from "lucide-react";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCreateAdminUser } from "@/hooks/use-admin";

export default function AdminUsers() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();
  const createAdmin = useCreateAdminUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createAdmin.mutateAsync({ username, password });
      toast({ title: "Administrador criado com sucesso!", description: `O usuário "${username}" agora tem acesso ao painel.` });
      setUsername("");
      setPassword("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Erro ao criar administrador",
        description: error.message,
      });
    }
  };

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-secondary/20">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-16 px-4 border-b bg-background shrink-0">
            <SidebarTrigger />
            <h2 className="ml-4 font-display font-semibold text-lg">Gerenciar Administradores</h2>
          </header>

          <main className="flex-1 overflow-auto p-4 md:p-8">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-lg mx-auto"
            >
              <Card className="border-0 shadow-xl shadow-black/5 rounded-2xl overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-xl bg-primary/10">
                      <ShieldPlus className="w-6 h-6 text-primary" />
                    </div>
                    <CardTitle className="text-xl font-bold font-display">Novo Administrador</CardTitle>
                  </div>
                  <CardDescription>
                    Crie uma nova conta com privilégios de administrador. Apenas administradores logados podem realizar esta ação.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="admin-username">Nome de usuário</Label>
                      <Input
                        id="admin-username"
                        placeholder="ex: coordenador"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                        required
                        minLength={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="admin-password">Senha</Label>
                      <Input
                        id="admin-password"
                        type="password"
                        placeholder="Mínimo 4 caracteres"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                        required
                        minLength={4}
                      />
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-12 rounded-xl text-md font-semibold shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200"
                      disabled={createAdmin.isPending || !username || !password}
                    >
                      {createAdmin.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <UserCheck className="mr-2 h-5 w-5" />
                          Criar Administrador
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
