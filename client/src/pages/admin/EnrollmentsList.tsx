import { useState } from "react";
import { Link } from "wouter";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAdminEnrollments } from "@/hooks/use-admin";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Search, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function AdminEnrollmentsList() {
  const { data: enrollments = [], isLoading } = useAdminEnrollments();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'approved': return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-0">Approved</Badge>;
      case 'rejected': return <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-0">Rejected</Badge>;
      case 'in_analysis': return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-0">In Analysis</Badge>;
      default: return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-0">Pending</Badge>;
    }
  };

  const filteredData = enrollments.filter((e: any) => {
    const matchesSearch = (e.name?.toLowerCase() || '').includes(search.toLowerCase()) || 
                          (e.cpf || '').includes(search);
    const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full bg-secondary/20">
        <AdminSidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center h-16 px-4 border-b bg-background shrink-0">
            <SidebarTrigger />
            <h2 className="ml-4 font-display font-semibold text-lg">Applications</h2>
          </header>
          
          <main className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">
              
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-background p-4 rounded-2xl border shadow-sm">
                <div className="relative w-full sm:w-96">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input 
                    placeholder="Search by name or CPF..." 
                    className="pl-9 h-10 rounded-xl bg-secondary/50 border-transparent focus:bg-background"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-48 flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="h-10 rounded-xl border-transparent bg-secondary/50 font-medium">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="in_analysis">In Analysis</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="pending">Pending Docs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Table */}
              <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
                <CardContent className="p-0">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="font-semibold h-12">ID</TableHead>
                        <TableHead className="font-semibold">Applicant</TableHead>
                        <TableHead className="font-semibold">CPF</TableHead>
                        <TableHead className="font-semibold">Date Submitted</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="text-right font-semibold">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                        </TableRow>
                      ) : filteredData.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                            No applications found matching criteria.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredData.map((enrollment: any) => (
                          <TableRow key={enrollment.id} className="hover:bg-secondary/50 transition-colors">
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              #{enrollment.id.toString().padStart(4, '0')}
                            </TableCell>
                            <TableCell className="font-medium">{enrollment.name || 'N/A'}</TableCell>
                            <TableCell className="text-muted-foreground">{enrollment.cpf || 'N/A'}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {enrollment.createdAt ? format(new Date(enrollment.createdAt), 'MMM dd, yyyy') : 'N/A'}
                            </TableCell>
                            <TableCell>{getStatusBadge(enrollment.status)}</TableCell>
                            <TableCell className="text-right">
                              <Link href={`/admin/enrollments/${enrollment.id}`}>
                                <Button size="sm" variant="ghost" className="hover:bg-primary/10 hover:text-primary rounded-lg font-semibold">
                                  <Eye className="w-4 h-4 mr-2" /> Review
                                </Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
