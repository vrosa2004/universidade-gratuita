import { motion } from "framer-motion";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAdminStats } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, Clock, CheckCircle2, XCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export default function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  // Theme setup for charts
  const COLORS = {
    pending: '#f59e0b', // amber
    inAnalysis: '#3b82f6', // blue
    approved: '#22c55e', // green
    rejected: '#ef4444' // red
  };

  const chartData = stats ? [
    { name: 'Docs Pendentes', value: stats.pending, color: COLORS.pending },
    { name: 'Em Análise', value: stats.inAnalysis, color: COLORS.inAnalysis },
    { name: 'Aprovados', value: stats.approved, color: COLORS.approved },
    { name: 'Rejeitados', value: stats.rejected, color: COLORS.rejected },
  ].filter(d => d.value > 0) : [];

  const statCards = [
    { title: "Total de Inscrições", value: stats?.total || 0, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { title: "Em Análise", value: stats?.inAnalysis || 0, icon: Clock, color: "text-blue-600", bg: "bg-blue-100" },
    { title: "Aprovados", value: stats?.approved || 0, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
    { title: "Rejeitados", value: stats?.rejected || 0, icon: XCircle, color: "text-red-600", bg: "bg-red-100" },
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-secondary/20">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-16 px-4 border-b bg-background shrink-0">
            <SidebarTrigger />
            <h2 className="ml-4 font-display font-semibold text-lg">Visão Geral</h2>
          </header>
          
          <main className="flex-1 overflow-auto p-4 md:p-8">
            {isLoading ? (
              <div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-6xl mx-auto space-y-8"
              >
                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {statCards.map((stat, i) => (
                    <Card key={i} className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden hover:-translate-y-1 transition-transform duration-300">
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className={`p-3 rounded-xl ${stat.bg}`}>
                            <stat.icon className={`w-6 h-6 ${stat.color}`} />
                          </div>
                        </div>
                        <h3 className="text-3xl font-bold font-display">{stat.value}</h3>
                        <p className="text-sm font-medium text-muted-foreground mt-1">{stat.title}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {/* Charts Area */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                    <CardHeader>
                      <CardTitle className="font-display">Distribuição de Inscrições</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px] flex items-center justify-center">
                      {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartData}
                              cx="50%"
                              cy="50%"
                              innerRadius={80}
                              outerRadius={110}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {chartData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                            <Legend verticalAlign="bottom" height={36} iconType="circle" />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <p className="text-muted-foreground">Nenhum dado disponível ainda.</p>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* System Insights Card */}
                  <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent">
                    <CardHeader>
                      <CardTitle className="font-display">Informações do Sistema</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        <div className="flex gap-4 items-start">
                          <div className="bg-white p-2 rounded-lg shadow-sm shrink-0">🤖</div>
                          <div>
                            <h4 className="font-semibold text-foreground">OCR Automatizado Ativo</h4>
                            <p className="text-sm text-muted-foreground mt-1">O sistema está extraindo dados dos documentos enviados para auxiliar na verificação.</p>
                          </div>
                        </div>
                        <div className="flex gap-4 items-start">
                          <div className="bg-white p-2 rounded-lg shadow-sm shrink-0">📏</div>
                          <div>
                            <h4 className="font-semibold text-foreground">Regras de Elegibilidade</h4>
                            <p className="text-sm text-muted-foreground mt-1">Limite automático: Renda per capita &lt; R$ 6.072 (4× salário mínimo) indica elegibilidade. Revisão manual necessária para casos especiais.</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

              </motion.div>
            )}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
