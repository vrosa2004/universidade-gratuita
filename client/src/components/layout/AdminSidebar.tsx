import { Link, useLocation } from "wouter";
import { LayoutDashboard, Users, LogOut, GraduationCap, ShieldPlus } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

export function AdminSidebar() {
  const [location] = useLocation();
  const { logout, user } = useAuth();

  const menuItems = [
    { title: "Painel", url: "/admin", icon: LayoutDashboard },
    { title: "Inscrições", url: "/admin/enrollments", icon: Users },
    { title: "Administradores", url: "/admin/users", icon: ShieldPlus },
  ];

  return (
    <Sidebar variant="inset" className="border-r">
      <SidebarHeader className="h-16 flex items-center px-4 border-b">
        <Link href="/admin" className="flex items-center gap-2 text-primary">
          <GraduationCap className="h-8 w-8" />
          <span className="font-display font-bold text-xl">Painel Admin</span>
        </Link>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Gerenciamento</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location === item.url || (location.startsWith(item.url) && item.url !== "/admin");
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={item.title}
                    >
                      <Link href={item.url} className={isActive ? "bg-primary/10 text-primary font-medium" : ""}>
                        <item.icon className={isActive ? "text-primary" : ""} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{user?.username}</span>
            <span className="text-xs text-muted-foreground">Administrador</span>
          </div>
        </div>
        <SidebarMenuButton onClick={() => logout()} className="text-destructive hover:text-destructive hover:bg-destructive/10">
          <LogOut className="h-4 w-4" />
          <span>Sair</span>
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
