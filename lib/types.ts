export interface P2PAd {
  adNo: string;
  tradeType: "BUY" | "SELL";
  asset: string;
  fiat: string;
  price: string;
  minSingleTransAmount: string;
  maxSingleTransAmount: string;
  tradableQuantity: string;
  advertiser: {
    userNo: string;
    nickName: string;
    monthOrderCount: number;
    monthFinishRate: number;
    userType: string;
  };
  tradeMethods: {
    identifier: string;
    tradeMethodName: string;
  }[];
}

export interface P2PData {
  buy: P2PAd[];
  sell: P2PAd[];
  lastUpdate: string;
  spread?: number;
  avgBuyPrice?: number;
  avgSellPrice?: number;
}

export interface P2PResponse {
  ok: boolean;
  data: P2PData;
  history?: P2PHistoryPoint[];
}

export interface P2PHistoryPoint {
  ts: number;
  buy: number;
  sell: number;
  spread: number;
}

export interface P2PStats {
  currentBuyPrice: number;
  currentSellPrice: number;
  spread: number;
  spreadPercentage: number;
  buyChange24h: number;
  sellChange24h: number;
  high24h: number;
  low24h: number;
  volume24h?: number;
}
