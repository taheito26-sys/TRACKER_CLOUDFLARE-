"use client";

import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  TrendingUp,
  Settings,
  Bell,
  RefreshCw,
} from "lucide-react";

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  lastUpdate: string | null;
  onRefresh: () => void;
  isLoading: boolean;
}

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "prices", label: "P2P Prices", icon: TrendingUp },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  activeTab,
  onTabChange,
  lastUpdate,
  onRefresh,
  isLoading,
}: SidebarProps) {
  return (
    <aside className="flex h-full w-[200px] flex-col border-r border-border bg-card">
      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-border p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-xs font-bold text-primary-foreground shadow-lg">
          P2P
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">P2P Tracker</p>
          <p className="text-xs text-muted-foreground">v1.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Status */}
      <div className="border-t border-border p-3">
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex w-full items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs transition-colors hover:bg-muted"
        >
          <span className="text-muted-foreground">
            {lastUpdate
              ? `Updated ${new Date(lastUpdate).toLocaleTimeString()}`
              : "Not loaded"}
          </span>
          <RefreshCw
            className={cn("h-3 w-3 text-muted-foreground", isLoading && "animate-spin")}
          />
        </button>
      </div>
    </aside>
  );
}
