import { motion } from "framer-motion";
import { Link } from "wouter";
import { StudentNavbar } from "@/components/layout/StudentNavbar";
import { useMyEnrollment } from "@/hooks/use-enrollments";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Clock, CheckCircle2, XCircle, ArrowRight, UploadCloud, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentDashboard() {
  const { data: enrollment, isLoading } = useMyEnrollment();

  const getStatusDisplay = (status?: string) => {
    switch(status) {
      case 'approved':
        return { color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle2, text: 'Approved! Welcome!' };
      case 'rejected':
        return { color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle, text: 'Application Rejected' };
      case 'in_analysis':
        return { color: 'bg-blue-100 text-blue-800 border-blue-200', icon: Clock, text: 'Under Review' };
      default:
        return { color: 'bg-amber-100 text-amber-800 border-amber-200', icon: AlertCircle, text: 'Pending Submission' };
    }
  };

  const statusInfo = getStatusDisplay(enrollment?.status);
  const StatusIcon = statusInfo.icon;

  const requiredDocs = ['rg', 'cpf', 'residence', 'transcript', 'income'];
  const uploadedDocsCount = enrollment?.documents ? 
    requiredDocs.filter(type => enrollment.documents.some((d: any) => d.type === type)).length : 0;
  
  const progressPercentage = enrollment ? ((uploadedDocsCount + (enrollment.name ? 1 : 0)) / 6) * 100 : 0;

  return (
    <div className="min-h-screen bg-secondary/30">
      <StudentNavbar />
      
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Student Portal</h1>
            <p className="text-muted-foreground mt-1">Track your university application status</p>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-48 w-full rounded-2xl" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Skeleton className="h-64 rounded-2xl" />
                <Skeleton className="h-64 rounded-2xl" />
              </div>
            </div>
          ) : !enrollment ? (
            <Card className="border-0 shadow-lg shadow-primary/5 rounded-2xl overflow-hidden relative">
              <div className="absolute top-0 left-0 w-2 h-full bg-primary" />
              <CardContent className="p-8 md:p-12 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <FileText className="h-10 w-10 text-primary" />
                </div>
                <h2 className="text-2xl font-bold font-display mb-2">Start Your Application</h2>
                <p className="text-muted-foreground max-w-md mx-auto mb-8">
                  You haven't started your enrollment process yet. Complete your profile and upload the required documents to apply for the free university program.
                </p>
                <Link href="/student/enroll">
                  <Button size="lg" className="rounded-xl px-8 h-14 text-lg shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-1 transition-all">
                    Begin Enrollment <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Status Card - Spans 2 columns on desktop */}
              <Card className="md:col-span-2 border-0 shadow-lg shadow-black/5 rounded-2xl overflow-hidden">
                <CardHeader className="bg-muted/50 border-b pb-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="font-display text-xl">Current Status</CardTitle>
                      <CardDescription>Application #APP-{enrollment.id.toString().padStart(4, '0')}</CardDescription>
                    </div>
                    <Badge variant="outline" className={`px-4 py-1.5 text-sm font-medium rounded-full border ${statusInfo.color}`}>
                      <StatusIcon className="w-4 h-4 mr-2" />
                      {statusInfo.text}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  {enrollment.status === 'pending' && (
                    <div className="space-y-6">
                      <div>
                        <div className="flex justify-between text-sm mb-2 font-medium">
                          <span>Application Progress</span>
                          <span className="text-primary">{Math.round(progressPercentage)}%</span>
                        </div>
                        <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercentage}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                          />
                        </div>
                      </div>
                      
                      <div className="bg-primary/5 rounded-xl p-4 flex items-start gap-4 border border-primary/10">
                        <UploadCloud className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-primary-foreground/90 text-foreground">Action Required</h4>
                          <p className="text-sm text-muted-foreground mt-1 mb-3">
                            You need to complete your profile and upload all 5 required documents before you can submit your application for review.
                          </p>
                          <Link href="/student/enroll">
                            <Button variant="outline" className="rounded-lg border-primary/20 text-primary hover:bg-primary/10">
                              Continue Application
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  )}

                  {enrollment.status === 'in_analysis' && (
                    <div className="text-center py-8">
                      <div className="relative w-24 h-24 mx-auto mb-6">
                        <div className="absolute inset-0 border-4 border-secondary rounded-full"></div>
                        <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                        <Clock className="absolute inset-0 m-auto h-8 w-8 text-blue-500" />
                      </div>
                      <h3 className="text-xl font-bold font-display">Application Under Review</h3>
                      <p className="text-muted-foreground max-w-sm mx-auto mt-2">
                        Our administrative team is currently reviewing your documents and verifying your eligibility. We will notify you once a decision is made.
                      </p>
                    </div>
                  )}

                  {enrollment.status === 'approved' && (
                    <div className="text-center py-8">
                      <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <CheckCircle2 className="h-12 w-12 text-green-600" />
                      </div>
                      <h3 className="text-2xl font-bold font-display text-green-700">Congratulations!</h3>
                      <p className="text-muted-foreground max-w-md mx-auto mt-2">
                        Your application has been approved. You are now officially enrolled in the Digital Free University. Check your email for next steps!
                      </p>
                    </div>
                  )}

                  {enrollment.status === 'rejected' && (
                    <div className="text-center py-8">
                      <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                        <XCircle className="h-12 w-12 text-red-600" />
                      </div>
                      <h3 className="text-2xl font-bold font-display text-red-700">Application Not Approved</h3>
                      <p className="text-muted-foreground max-w-md mx-auto mt-2">
                        Unfortunately, your application did not meet the eligibility criteria for the free university program at this time.
                      </p>
                    </div>
                  )}

                  {enrollment.status !== 'pending' && (
                    <div className="mt-6 pt-6 border-t flex items-center justify-between bg-primary/5 -mx-6 px-6 pb-6 mb-[-1.5rem]">
                      <div className="flex items-center gap-3">
                        <UploadCloud className="h-5 w-5 text-primary" />
                        <div>
                          <p className="text-sm font-semibold">Atualizar Documentos</p>
                          <p className="text-xs text-muted-foreground">Você ainda pode atualizar seus anexos</p>
                        </div>
                      </div>
                      <Link href="/student/enroll">
                        <Button variant="outline" size="sm" className="rounded-lg border-primary/20 text-primary hover:bg-primary/10">
                          Editar Arquivos
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Profile Summary Card */}
              <Card className="border-0 shadow-lg shadow-black/5 rounded-2xl h-fit">
                <CardHeader>
                  <CardTitle className="font-display text-lg">Profile Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Full Name</p>
                    <p className="font-medium">{enrollment.name || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">CPF</p>
                    <p className="font-medium">{enrollment.cpf || 'Not provided'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Income</p>
                    <p className="font-medium">{enrollment.income ? `R$ ${enrollment.income.toLocaleString()}` : 'Not provided'}</p>
                  </div>
                  <div className="pt-4 border-t">
                    <div className="flex justify-between items-center mb-2">
                      <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Documents</p>
                      <Badge variant="secondary" className="rounded-full">{uploadedDocsCount}/5</Badge>
                    </div>
                    <Link href="/student/enroll">
                      <Button variant="link" className="px-0 text-primary h-auto">Manage Documents &rarr;</Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>

            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
}
