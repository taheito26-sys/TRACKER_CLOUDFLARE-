"use client";

import { useState, useEffect, useCallback } from "react";
import { Sidebar } from "./sidebar";
import { KPICard } from "./kpi-card";
import { PriceTable } from "./price-table";
import { PriceChart } from "./price-chart";
import { formatNumber, formatPercentage } from "@/lib/utils";
import { P2PData, P2PAd } from "@/lib/types";
import {
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  DollarSign,
  Activity,
  Loader2,
} from "lucide-react";

interface DashboardState {
  data: P2PData | null;
  history: { time: string; buy: number; sell: number }[];
  isLoading: boolean;
  error: string | null;
}

export function Dashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [state, setState] = useState<DashboardState>({
    data: null,
    history: [],
    isLoading: true,
    error: null,
  });

  const fetchData = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch("/api/p2p?fiat=QAR&asset=USDT");
      const json = await response.json();

      if (!json.ok) {
        throw new Error(json.error || "Failed to fetch data");
      }

      const newHistoryPoint = {
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        buy: json.data.avgBuyPrice || 0,
        sell: json.data.avgSellPrice || 0,
      };

      setState((prev) => ({
        ...prev,
        data: json.data,
        history: [...prev.history.slice(-23), newHistoryPoint],
        isLoading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 120000); // 2 minutes
    return () => clearInterval(interval);
  }, [fetchData]);

  const { data, history, isLoading, error } = state;

  const avgBuyPrice = data?.avgBuyPrice || 0;
  const avgSellPrice = data?.avgSellPrice || 0;
  const spread = avgBuyPrice - avgSellPrice;
  const spreadPercent = avgSellPrice > 0 ? (spread / avgSellPrice) * 100 : 0;

  const renderContent = () => {
    if (error) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-semibold text-destructive">Error loading data</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (isLoading && !data) {
      return (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Loading P2P data...</p>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case "dashboard":
        return (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KPICard
                title="Avg Buy Price"
                value={`${formatNumber(avgBuyPrice, 4)} QAR`}
                subtitle="Top 5 merchants"
                icon={TrendingUp}
                trend="neutral"
              />
              <KPICard
                title="Avg Sell Price"
                value={`${formatNumber(avgSellPrice, 4)} QAR`}
                subtitle="Top 5 merchants"
                icon={TrendingDown}
                trend="neutral"
              />
              <KPICard
                title="Spread"
                value={`${formatNumber(spread, 4)} QAR`}
                subtitle={formatPercentage(spreadPercent)}
                icon={ArrowLeftRight}
                trend={spread > 0 ? "up" : spread < 0 ? "down" : "neutral"}
              />
              <KPICard
                title="Market Status"
                value={data?.buy.length || 0}
                subtitle={`${data?.sell.length || 0} sell offers`}
                icon={Activity}
              />
            </div>

            {/* Chart */}
            <PriceChart data={history} />

            {/* Quick View Tables */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <PriceTable
                title="Buy Offers (You Pay)"
                ads={data?.buy || []}
                type="buy"
              />
              <PriceTable
                title="Sell Offers (You Receive)"
                ads={data?.sell || []}
                type="sell"
              />
            </div>
          </div>
        );

      case "prices":
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">P2P Price Book</h2>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  USDT/QAR
                </span>
              </div>
            </div>
            <PriceTable
              title="Buy Offers (You Pay)"
              ads={data?.buy || []}
              type="buy"
            />
            <PriceTable
              title="Sell Offers (You Receive)"
              ads={data?.sell || []}
              type="sell"
            />
          </div>
        );

      case "alerts":
        return (
          <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed border-border">
            <div className="text-center">
              <DollarSign className="mx-auto h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">Price Alerts</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Set up price alerts to get notified when prices reach your target.
                Coming soon.
              </p>
            </div>
          </div>
        );

      case "settings":
        return (
          <div className="max-w-md space-y-6">
            <h2 className="text-lg font-semibold text-foreground">Settings</h2>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium text-foreground">Trading Pair</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Currently monitoring USDT/QAR on Binance P2P
              </p>
              <div className="mt-3 flex gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  USDT
                </span>
                <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                  QAR
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium text-foreground">Refresh Rate</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Data refreshes every 2 minutes automatically
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        lastUpdate={data?.lastUpdate || null}
        onRefresh={fetchData}
        isLoading={isLoading}
      />
      <main className="flex-1 overflow-auto p-6">{renderContent()}</main>
    </div>
  );
}
