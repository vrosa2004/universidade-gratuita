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
    { name: 'Pending Docs', value: stats.pending, color: COLORS.pending },
    { name: 'In Analysis', value: stats.inAnalysis, color: COLORS.inAnalysis },
    { name: 'Approved', value: stats.approved, color: COLORS.approved },
    { name: 'Rejected', value: stats.rejected, color: COLORS.rejected },
  ].filter(d => d.value > 0) : [];

  const statCards = [
    { title: "Total Applications", value: stats?.total || 0, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { title: "Under Review", value: stats?.inAnalysis || 0, icon: Clock, color: "text-blue-600", bg: "bg-blue-100" },
    { title: "Approved", value: stats?.approved || 0, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-100" },
    { title: "Rejected", value: stats?.rejected || 0, icon: XCircle, color: "text-red-600", bg: "bg-red-100" },
  ];

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-secondary/20">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-16 px-4 border-b bg-background shrink-0">
            <SidebarTrigger />
            <h2 className="ml-4 font-display font-semibold text-lg">Dashboard Overview</h2>
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
                      <CardTitle className="font-display">Application Distribution</CardTitle>
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
                        <p className="text-muted-foreground">No data available yet.</p>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* System Insights Card */}
                  <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent">
                    <CardHeader>
                      <CardTitle className="font-display">System Insights</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-6">
                        <div className="flex gap-4 items-start">
                          <div className="bg-white p-2 rounded-lg shadow-sm shrink-0">🤖</div>
                          <div>
                            <h4 className="font-semibold text-foreground">Automated OCR Active</h4>
                            <p className="text-sm text-muted-foreground mt-1">The system is currently extracting data from uploaded documents to assist with verification.</p>
                          </div>
                        </div>
                        <div className="flex gap-4 items-start">
                          <div className="bg-white p-2 rounded-lg shadow-sm shrink-0">📏</div>
                          <div>
                            <h4 className="font-semibold text-foreground">Eligibility Rules</h4>
                            <p className="text-sm text-muted-foreground mt-1">Current auto-decision threshold: Income &lt; R$ 2000 implies eligible. Manual override required for edge cases.</p>
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
