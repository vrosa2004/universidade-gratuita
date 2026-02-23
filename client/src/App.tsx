import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/AuthPage";
import StudentDashboard from "@/pages/student/Dashboard";
import StudentEnrollment from "@/pages/student/Enrollment";
import AdminDashboard from "@/pages/admin/Dashboard";
import AdminEnrollmentsList from "@/pages/admin/EnrollmentsList";
import AdminEnrollmentReview from "@/pages/admin/EnrollmentReview";

// Protected Route Wrapper
function ProtectedRoute({ component: Component, role }: { component: React.ComponentType, role: 'student' | 'admin' }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-background"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (user.role !== role) {
    // Redirect to their actual portal if wrong role accessed
    return <Redirect to={user.role === 'admin' ? '/admin' : '/student'} />;
  }

  return <Component />;
}

function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null; // handled in app root or specific routes usually

  return (
    <Switch>
      {/* Root redirects based on auth state */}
      <Route path="/">
        {user ? <Redirect to={user.role === 'admin' ? '/admin' : '/student'} /> : <Redirect to="/auth" />}
      </Route>

      <Route path="/auth" component={AuthPage} />

      {/* Student Routes */}
      <Route path="/student">
        {() => <ProtectedRoute role="student" component={StudentDashboard} />}
      </Route>
      <Route path="/student/enroll">
        {() => <ProtectedRoute role="student" component={StudentEnrollment} />}
      </Route>

      {/* Admin Routes */}
      <Route path="/admin">
        {() => <ProtectedRoute role="admin" component={AdminDashboard} />}
      </Route>
      <Route path="/admin/enrollments">
        {() => <ProtectedRoute role="admin" component={AdminEnrollmentsList} />}
      </Route>
      <Route path="/admin/enrollments/:id">
        {() => <ProtectedRoute role="admin" component={AdminEnrollmentReview} />}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
