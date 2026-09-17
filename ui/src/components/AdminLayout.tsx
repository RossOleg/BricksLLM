import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  KeyRound, Settings, Users, BarChart3,
  Globe, Shield, GitBranch, LogOut, Cpu, Lock, TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";
import UnlockDialog from "@/components/UnlockDialog";

// supportOnly помечает то, что доступно и без полного доступа. Остальное
// сервер всё равно не пустит, так что рисовать его смысла нет.
const navItems = [
  { to: "/keys", label: "Keys", icon: KeyRound, supportOnly: true },
  { to: "/provider-settings", label: "Providers", supportOnly: false, icon: Settings },
  { to: "/users", label: "Users", supportOnly: false, icon: Users },
  { to: "/reporting", label: "Reporting", supportOnly: false, icon: BarChart3 },
  { to: "/top-keys", label: "Top keys", supportOnly: false, icon: TrendingUp },
  { to: "/routes", label: "Routes", supportOnly: false, icon: GitBranch },
  { to: "/custom-providers", label: "Custom Providers", supportOnly: false, icon: Globe },
  { to: "/policies", label: "Policies", supportOnly: false, icon: Shield },
];

const AdminLayout: React.FC = () => {
  const { logout, isFull } = useAuth();
  const navigate = useNavigate();
  const [unlocking, setUnlocking] = useState(false);

  const visibleItems = navItems.filter((item) => isFull || item.supportOnly);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-5 py-4">
          <Cpu className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm tracking-tight">BricksLLM</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-3">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3 space-y-2">
          {!isFull && (
            <button
              onClick={() => setUnlocking(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50"
            >
              <Lock className="h-4 w-4" />
              Unlock full access
            </button>
          )}
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
    </div>
  );
};

export default AdminLayout;
