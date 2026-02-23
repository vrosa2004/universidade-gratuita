import { useRoute, useLocation } from "wouter";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAdminEnrollments, useUpdateEnrollmentStatus } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, FileText, BrainCircuit, AlertTriangle, ArrowLeft, Eye } from "lucide-react";
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
  if (!enrollment) return <div className="p-8 text-center">Application not found</div>;

  const handleStatusChange = async (status: 'approved' | 'rejected' | 'pending') => {
    try {
      await updateStatusMutation.mutateAsync({ id, status });
      toast({ title: `Application ${status} successfully` });
      setLocation('/admin/enrollments');
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const getSystemRecommendation = () => {
    if (!enrollment.income) return { text: "Insufficient data", color: "text-amber-600", bg: "bg-amber-100" };
    if (enrollment.income < 2000) return { text: "Eligible (Income < 2000)", color: "text-green-600", bg: "bg-green-100" };
    return { text: "Not Eligible (Income >= 2000)", color: "text-red-600", bg: "bg-red-100" };
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
            <h2 className="font-display font-semibold text-lg">Review Application #{id.toString().padStart(4, '0')}</h2>
          </header>
          
          <main className="flex-1 overflow-auto p-4 md:p-8">
            <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              {/* Left Column: Details & OCR */}
              <div className="lg:col-span-1 space-y-6">
                
                {/* Actions Card */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex justify-between items-center mb-6">
                      <span className="text-sm font-semibold text-muted-foreground uppercase">Current Status</span>
                      <Badge className="capitalize">{enrollment.status.replace('_', ' ')}</Badge>
                    </div>
                    
                    <Button 
                      onClick={() => handleStatusChange('approved')} 
                      disabled={updateStatusMutation.isPending}
                      className="w-full h-12 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-md shadow-lg shadow-green-600/20"
                    >
                      <CheckCircle2 className="mr-2 h-5 w-5" /> Approve Application
                    </Button>
                    <Button 
                      onClick={() => handleStatusChange('rejected')} 
                      disabled={updateStatusMutation.isPending}
                      variant="destructive"
                      className="w-full h-12 rounded-xl font-bold text-md shadow-lg shadow-red-600/20"
                    >
                      <XCircle className="mr-2 h-5 w-5" /> Reject Application
                    </Button>
                    <Button 
                      onClick={() => handleStatusChange('pending')} 
                      disabled={updateStatusMutation.isPending}
                      variant="outline"
                      className="w-full h-12 rounded-xl font-bold text-md"
                    >
                      Mark as Pending (Need Docs)
                    </Button>
                  </CardContent>
                </Card>

                {/* AI Analysis Card */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-display flex items-center text-lg">
                      <BrainCircuit className="w-5 h-5 mr-2 text-primary" />
                      System Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className={`p-4 rounded-xl flex items-start gap-3 ${recommendation.bg}`}>
                      <AlertTriangle className={`w-5 h-5 shrink-0 ${recommendation.color}`} />
                      <div>
                        <p className={`font-bold text-sm ${recommendation.color}`}>Recommendation</p>
                        <p className={`text-sm mt-0.5 ${recommendation.color}`}>{recommendation.text}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Applicant Data */}
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl">
                  <CardHeader>
                    <CardTitle className="font-display text-lg">Applicant Data</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      { label: 'Name', value: enrollment.name },
                      { label: 'CPF', value: enrollment.cpf },
                      { label: 'Date of Birth', value: enrollment.dateOfBirth },
                      { label: 'Income Declared', value: enrollment.income ? `R$ ${enrollment.income}` : null },
                      { label: 'Date Applied', value: enrollment.createdAt ? format(new Date(enrollment.createdAt), 'PPpp') : null },
                    ].map((item, i) => (
                      <div key={i} className="border-b last:border-0 pb-3 last:pb-0">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{item.label}</p>
                        <p className="font-medium text-foreground">{item.value || '-'}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>

              </div>

              {/* Right Column: Documents Viewer */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl h-full min-h-[600px] flex flex-col">
                  <CardHeader className="border-b bg-muted/30">
                    <CardTitle className="font-display">Submitted Documents</CardTitle>
                    <CardDescription>{enrollment.documents?.length || 0} of 5 required documents uploaded</CardDescription>
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
                                Uploaded {format(new Date(doc.uploadedAt), 'MMM dd')}
                              </p>
                              
                              {/* Mock OCR Data Display */}
                              <div className="mt-4 bg-secondary/50 p-3 rounded-lg border border-border">
                                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center">
                                  <BrainCircuit className="w-3 h-3 mr-1" /> OCR Extracted
                                </p>
                                {doc.ocrData ? (
                                  <pre className="text-xs overflow-auto font-mono text-primary/80">
                                    {JSON.stringify(doc.ocrData, null, 2)}
                                  </pre>
                                ) : (
                                  <p className="text-xs text-muted-foreground italic">No data extracted</p>
                                )}
                              </div>
                            </div>
                            
                            <div className="w-full md:w-2/3 bg-black/5 rounded-xl border border-black/10 flex items-center justify-center min-h-[250px] overflow-hidden group relative">
                              {/* If URL contains data:image, render it, else show placeholder */}
                              {doc.url?.startsWith('data:image') ? (
                                <img src={doc.url} alt={doc.name} className="max-w-full max-h-full object-contain" />
                              ) : (
                                <div className="text-center text-muted-foreground">
                                  <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                  <p className="text-sm font-medium">Document Preview</p>
                                  <p className="text-xs">Click to view full size</p>
                                </div>
                              )}
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                <Button variant="secondary" className="rounded-xl font-bold shadow-xl">
                                  <Eye className="w-4 h-4 mr-2" /> View Full Document
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground">
                        <FileText className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-lg font-medium">No documents uploaded yet</p>
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
