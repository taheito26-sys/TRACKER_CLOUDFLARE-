import test from 'node:test';
import assert from 'node:assert/strict';
import resolveP2PProfitModel from './p2p-profit-model.js';

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test('computes direct profit when market fiat matches accounting currency', () => {
  const result = resolveP2PProfitModel({
    holdingsQty: 100,
    avgCostPerUsdtInAccounting: 3.6,
    accountingCurrency: 'QAR',
    marketFiat: 'QAR',
    marketSellAvgPerUsdt: 3.8,
  });
  assert.equal(result.available, true);
  assert.equal(result.model, 'per-market');
  assertClose(result.profitIfSoldNow, 20);
  assert.equal(result.normalizedSellAvgPerUsdtInAccounting, 3.8);
});

test('computes normalized profit when explicit normalization is provided', () => {
  const result = resolveP2PProfitModel({
    holdingsQty: 50,
    avgCostPerUsdtInAccounting: 3.5,
    accountingCurrency: 'QAR',
    marketFiat: 'AED',
    marketSellAvgPerUsdt: 3.7,
    normalizationRateToAccounting: 1.02,
  });
  assert.equal(result.available, true);
  assert.equal(result.model, 'normalized-base-currency');
  assertClose(result.normalizedSellAvgPerUsdtInAccounting, 3.774);
  assertClose(result.profitIfSoldNow, 13.70000000000001);
});

test('is unavailable when holdings are missing', () => {
  const result = resolveP2PProfitModel({
    holdingsQty: 0,
    avgCostPerUsdtInAccounting: 3.5,
    accountingCurrency: 'QAR',
    marketFiat: 'QAR',
    marketSellAvgPerUsdt: 3.7,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'holdings-missing');
});

test('is unavailable when cost basis is missing', () => {
  const result = resolveP2PProfitModel({
    holdingsQty: 10,
    avgCostPerUsdtInAccounting: null,
    accountingCurrency: 'QAR',
    marketFiat: 'QAR',
    marketSellAvgPerUsdt: 3.7,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'cost-basis-missing');
});

test('does not compare mismatched currencies without normalization data', () => {
  const result = resolveP2PProfitModel({
    holdingsQty: 25,
    avgCostPerUsdtInAccounting: 3.6,
    accountingCurrency: 'QAR',
    marketFiat: 'EGP',
    marketSellAvgPerUsdt: 50,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, 'normalization-missing');
});

test('switching markets keeps mismatch unavailable until explicit normalization exists', () => {
  const base = {
    holdingsQty: 25,
    avgCostPerUsdtInAccounting: 3.6,
    accountingCurrency: 'QAR',
  };
  const qatar = resolveP2PProfitModel({ ...base, marketFiat: 'QAR', marketSellAvgPerUsdt: 3.7 });
  const uae = resolveP2PProfitModel({ ...base, marketFiat: 'AED', marketSellAvgPerUsdt: 3.68 });
  const egypt = resolveP2PProfitModel({ ...base, marketFiat: 'EGP', marketSellAvgPerUsdt: 50 });
  assert.equal(qatar.available, true);
  assert.equal(uae.available, false);
  assert.equal(egypt.available, false);
});
