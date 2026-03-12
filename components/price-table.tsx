"use client";

import { cn, formatNumber } from "@/lib/utils";
import { P2PAd } from "@/lib/types";

interface PriceTableProps {
  title: string;
  ads: P2PAd[];
  type: "buy" | "sell";
  className?: string;
}

export function PriceTable({ title, ads, type, className }: PriceTableProps) {
  const isBuy = type === "buy";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card overflow-hidden",
        className
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Merchant
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Price (QAR)
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Available
              </th>
              <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Limits
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Payment
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ads.slice(0, 10).map((ad, idx) => (
              <tr
                key={ad.adNo || idx}
                className="transition-colors hover:bg-muted/20"
              >
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {ad.advertiser?.nickName || "Unknown"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {ad.advertiser?.monthOrderCount || 0} orders |{" "}
                      {((ad.advertiser?.monthFinishRate || 0) * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span
                    className={cn(
                      "text-sm font-semibold font-mono",
                      isBuy ? "text-red-400" : "text-green-400"
                    )}
                  >
                    {formatNumber(parseFloat(ad.price), 2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-mono text-foreground">
                    {formatNumber(parseFloat(ad.tradableQuantity), 2)} {ad.asset}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-xs text-muted-foreground">
                    {formatNumber(parseFloat(ad.minSingleTransAmount), 0)} -{" "}
                    {formatNumber(parseFloat(ad.maxSingleTransAmount), 0)} QAR
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {ad.tradeMethods?.slice(0, 2).map((method, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      >
                        {method.tradeMethodName || method.identifier}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {ads.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No ads available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
