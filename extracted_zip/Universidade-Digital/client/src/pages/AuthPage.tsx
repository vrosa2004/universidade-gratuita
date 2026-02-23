import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { GraduationCap, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { login, register, isLoggingIn, isRegistering } = useAuth();
  const { toast } = useToast();
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"student" | "admin">("student");

  const handleAuth = async (action: 'login' | 'register') => {
    try {
      if (action === 'login') {
        const user = await login({ username, password });
        toast({ title: "Welcome back!" });
        setLocation(user.role === 'admin' ? '/admin' : '/student');
      } else {
        const user = await register({ username, password, role });
        toast({ title: "Account created successfully!" });
        setLocation(user.role === 'admin' ? '/admin' : '/student');
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Left side - Decorative */}
      <div className="hidden md:flex flex-1 relative bg-primary items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary to-accent opacity-90" />
        
        {/* Decorative background pattern */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />
        
        <div className="relative z-10 p-12 text-primary-foreground max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <GraduationCap className="h-16 w-16 mb-8" />
            <h1 className="text-4xl md:text-5xl font-display font-bold mb-6 leading-tight">
              Your future starts here.
            </h1>
            <p className="text-lg opacity-90 leading-relaxed">
              Join the Digital Free University. Apply for full scholarships and get access to world-class education from anywhere.
            </p>
          </motion.div>
        </div>
      </div>

      {/* Right side - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="md:hidden flex items-center gap-2 text-primary mb-8 justify-center">
            <GraduationCap className="h-8 w-8" />
            <span className="font-display font-bold text-2xl">UniDigital</span>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8 h-12 p-1 bg-secondary rounded-xl">
              <TabsTrigger value="login" className="rounded-lg text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:shadow-sm">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card className="border-0 shadow-2xl shadow-primary/5 rounded-2xl overflow-hidden">
                <CardHeader className="space-y-1 pb-6">
                  <CardTitle className="text-2xl font-bold font-display">Welcome back</CardTitle>
                  <CardDescription>Enter your credentials to access your portal</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-username">Username</Label>
                    <Input 
                      id="login-username" 
                      placeholder="e.g. student123" 
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input 
                      id="login-password" 
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                    />
                  </div>
                  <Button 
                    className="w-full h-12 rounded-xl text-md font-semibold mt-4 shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200" 
                    onClick={() => handleAuth('login')}
                    disabled={isLoggingIn || !username || !password}
                  >
                    {isLoggingIn ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign In"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card className="border-0 shadow-2xl shadow-primary/5 rounded-2xl overflow-hidden">
                <CardHeader className="space-y-1 pb-6">
                  <CardTitle className="text-2xl font-bold font-display">Start your journey</CardTitle>
                  <CardDescription>Create a new account to apply</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-username">Username</Label>
                    <Input 
                      id="reg-username" 
                      placeholder="Choose a username" 
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">Password</Label>
                    <Input 
                      id="reg-password" 
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 px-4 rounded-xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary transition-all"
                    />
                  </div>
                  
                  {/* Demo purpose: allow selecting role */}
                  <div className="space-y-2 pt-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Account Type (Demo)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant={role === 'student' ? 'default' : 'outline'} 
                        className={`rounded-lg h-10 ${role === 'student' ? 'shadow-md' : ''}`}
                        onClick={() => setRole('student')}
                      >
                        Student
                      </Button>
                      <Button 
                        variant={role === 'admin' ? 'default' : 'outline'} 
                        className={`rounded-lg h-10 ${role === 'admin' ? 'shadow-md bg-slate-800 hover:bg-slate-700' : ''}`}
                        onClick={() => setRole('admin')}
                      >
                        Admin
                      </Button>
                    </div>
                  </div>

                  <Button 
                    className="w-full h-12 rounded-xl text-md font-semibold mt-4 shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200" 
                    onClick={() => handleAuth('register')}
                    disabled={isRegistering || !username || !password}
                  >
                    {isRegistering ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                      <>Create Account <ArrowRight className="ml-2 h-4 w-4" /></>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </div>
  );
}
