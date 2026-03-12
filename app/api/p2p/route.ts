import { NextResponse } from "next/server";

const BINANCE_P2P_URL = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

interface BinanceRequest {
  fiat: string;
  page: number;
  rows: number;
  tradeType: "BUY" | "SELL";
  asset: string;
  countries: string[];
  proMerchantAds: boolean;
  shieldMerchantAds: boolean;
  publisherType: null;
  payTypes: string[];
}

async function fetchBinanceP2P(tradeType: "BUY" | "SELL", fiat = "QAR", asset = "USDT") {
  const payload: BinanceRequest = {
    fiat,
    page: 1,
    rows: 10,
    tradeType,
    asset,
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
    publisherType: null,
    payTypes: [],
  };

  const response = await fetch(BINANCE_P2P_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fiat = searchParams.get("fiat") || "QAR";
  const asset = searchParams.get("asset") || "USDT";

  try {
    const [buyData, sellData] = await Promise.all([
      fetchBinanceP2P("BUY", fiat, asset),
      fetchBinanceP2P("SELL", fiat, asset),
    ]);

    const buyAds = buyData.map((item: { adv: Record<string, unknown>; advertiser: Record<string, unknown> }) => ({
      ...item.adv,
      advertiser: item.advertiser,
    }));

    const sellAds = sellData.map((item: { adv: Record<string, unknown>; advertiser: Record<string, unknown> }) => ({
      ...item.adv,
      advertiser: item.advertiser,
    }));

    // Calculate averages
    const avgBuyPrice = buyAds.length > 0
      ? buyAds.slice(0, 5).reduce((sum: number, ad: { price: string }) => sum + parseFloat(ad.price), 0) / Math.min(buyAds.length, 5)
      : 0;

    const avgSellPrice = sellAds.length > 0
      ? sellAds.slice(0, 5).reduce((sum: number, ad: { price: string }) => sum + parseFloat(ad.price), 0) / Math.min(sellAds.length, 5)
      : 0;

    const spread = avgBuyPrice - avgSellPrice;

    return NextResponse.json({
      ok: true,
      data: {
        buy: buyAds,
        sell: sellAds,
        lastUpdate: new Date().toISOString(),
        avgBuyPrice,
        avgSellPrice,
        spread,
      },
    });
  } catch (error) {
    console.error("P2P API error:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to fetch P2P data" },
      { status: 500 }
    );
  }
}
