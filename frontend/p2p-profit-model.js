(function(root, factory){
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.resolveP2PProfitModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function toNum(value){
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function resolveP2PProfitModel(input){
    var holdingsQty = toNum(input && input.holdingsQty);
    var avgCostPerUsdtInAccounting = toNum(input && input.avgCostPerUsdtInAccounting);
    var marketSellAvgPerUsdt = toNum(input && input.marketSellAvgPerUsdt);
    var accountingCurrency = String((input && input.accountingCurrency) || '').toUpperCase();
    var marketFiat = String((input && input.marketFiat) || '').toUpperCase();
    var normalizationRateToAccounting = toNum(input && input.normalizationRateToAccounting);

    if (!(holdingsQty > 0)) {
      return {
        available: false,
        model: 'unavailable',
        reason: 'holdings-missing',
        subtitle: 'No real USDT stock available.'
      };
    }
    if (!(avgCostPerUsdtInAccounting > 0)) {
      return {
        available: false,
        model: 'unavailable',
        reason: 'cost-basis-missing',
        subtitle: 'Cost basis unavailable.'
      };
    }
    if (!(marketSellAvgPerUsdt > 0) || !marketFiat) {
      return {
        available: false,
        model: 'unavailable',
        reason: 'market-price-missing',
        subtitle: 'Market sell average unavailable.'
      };
    }
    if (!accountingCurrency) {
      return {
        available: false,
        model: 'unavailable',
        reason: 'accounting-currency-missing',
        subtitle: 'Accounting currency unavailable.'
      };
    }

    if (marketFiat === accountingCurrency) {
      var directProfit = holdingsQty * (marketSellAvgPerUsdt - avgCostPerUsdtInAccounting);
      return {
        available: true,
        model: 'per-market',
        holdingsQty: holdingsQty,
        accountingCurrency: accountingCurrency,
        marketFiat: marketFiat,
        avgCostPerUsdtInAccounting: avgCostPerUsdtInAccounting,
        normalizedSellAvgPerUsdtInAccounting: marketSellAvgPerUsdt,
        profitIfSoldNow: directProfit,
        subtitle: holdingsQty.toFixed(2) + ' USDT · FIFO cost basis in ' + accountingCurrency
      };
    }

    if (normalizationRateToAccounting > 0) {
      var normalizedSellAvg = marketSellAvgPerUsdt * normalizationRateToAccounting;
      var normalizedProfit = holdingsQty * (normalizedSellAvg - avgCostPerUsdtInAccounting);
      return {
        available: true,
        model: 'normalized-base-currency',
        holdingsQty: holdingsQty,
        accountingCurrency: accountingCurrency,
        marketFiat: marketFiat,
        avgCostPerUsdtInAccounting: avgCostPerUsdtInAccounting,
        normalizedSellAvgPerUsdtInAccounting: normalizedSellAvg,
        normalizationRateToAccounting: normalizationRateToAccounting,
        profitIfSoldNow: normalizedProfit,
        subtitle: holdingsQty.toFixed(2) + ' USDT · normalized ' + marketFiat + ' → ' + accountingCurrency
      };
    }

    return {
      available: false,
      model: 'unavailable',
      reason: 'normalization-missing',
      holdingsQty: holdingsQty,
      accountingCurrency: accountingCurrency,
      marketFiat: marketFiat,
      subtitle: 'Need ' + marketFiat + ' → ' + accountingCurrency + ' normalization data.'
    };
  }

  return resolveP2PProfitModel;
});
