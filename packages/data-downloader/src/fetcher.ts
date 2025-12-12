// ============================================================================
// CCXT 数据获取器
// 使用 CCXT 库从各交易所获取历史数据
// 支持 K线、资金费率、标记价格、持仓量、聚合成交
// ============================================================================

import ccxt, { Exchange, OHLCV } from 'ccxt';

import {
  type ExchangeId,
  type RawKline,
  type RawFundingRate,
  type RawMarkPrice,
  type RawOpenInterest,
  type RawAggTrade,
  type SymbolInfo,
} from './types';

// ============================================================================
// 交易所实例创建
// ============================================================================

/**
 * 创建 CCXT 交易所实例
 * 根据交易所 ID 创建对应的实例
 *
 * @param exchangeId - 交易所 ID
 * @returns CCXT 交易所实例
 */
export function createExchangeInstance(exchangeId: ExchangeId): Exchange {
  // 根据交易所 ID 创建实例
  switch (exchangeId) {
    case 'binance':
      // 创建币安期货实例
      return new ccxt.binance({
        // 启用期货市场
        options: {
          defaultType: 'future',
          // 使用 USDT 永续合约
          defaultSubType: 'linear',
        },
        // 启用限速
        enableRateLimit: true,
        // 设置超时
        timeout: 30000,
      });

    case 'bybit':
      // 创建 Bybit 实例
      return new ccxt.bybit({
        // 启用统一账户
        options: {
          defaultType: 'linear',
        },
        enableRateLimit: true,
        timeout: 30000,
      });

    case 'okx':
      // 创建 OKX 实例
      return new ccxt.okx({
        // 使用永续合约
        options: {
          defaultType: 'swap',
        },
        enableRateLimit: true,
        timeout: 30000,
      });

    default:
      // 不支持的交易所
      throw new Error(`Unsupported exchange: ${exchangeId}`);
  }
}

// ============================================================================
// 符号转换工具
// ============================================================================

/**
 * 统一符号转换为交易所原始符号
 *
 * @param exchangeId - 交易所 ID
 * @param symbol - 统一符号（如 BTC/USDT:USDT）
 * @returns 交易所原始符号
 */
export function toExchangeSymbol(exchangeId: ExchangeId, symbol: string): string {
  // CCXT 使用统一格式，大多数情况直接返回
  // 但某些交易所可能需要特殊处理
  return symbol;
}

/**
 * 交易所原始符号转换为统一符号
 *
 * @param exchangeId - 交易所 ID
 * @param rawSymbol - 原始符号
 * @returns 统一符号
 */
export function toUnifiedSymbol(exchangeId: ExchangeId, rawSymbol: string): string {
  // CCXT 已经标准化了符号格式
  return rawSymbol;
}

// ============================================================================
// 市场信息获取
// ============================================================================

/**
 * 获取交易所支持的所有永续合约交易对
 *
 * @param exchange - CCXT 交易所实例
 * @param exchangeId - 交易所 ID
 * @returns 交易对信息列表
 */
export async function fetchMarkets(
  exchange: Exchange,
  exchangeId: ExchangeId
): Promise<SymbolInfo[]> {
  // 加载市场信息
  await exchange.loadMarkets();

  // 结果数组
  const symbols: SymbolInfo[] = [];

  // 遍历所有市场
  for (const [symbol, market] of Object.entries(exchange.markets)) {
    // 只处理永续合约
    if (!market.swap) {
      continue;
    }

    // 只处理 USDT 本位合约
    if (market.settle !== 'USDT' && market.quote !== 'USDT') {
      continue;
    }

    // 只处理活跃的市场
    if (!market.active) {
      continue;
    }

    // 构建交易对信息
    const info: SymbolInfo = {
      // 交易所 ID
      exchange: exchangeId,
      // 统一符号
      symbol,
      // 原始符号（CCXT 中 id 字段）
      rawSymbol: market.id,
      // 基础货币
      base: market.base,
      // 计价货币
      quote: market.quote,
      // 结算货币
      settle: market.settle || market.quote,
      // 合约乘数
      contractSize: market.contractSize,
      // 最小下单量
      minAmount: market.limits?.amount?.min,
      // 价格精度
      pricePrecision: market.precision?.price as number | undefined,
      // 数量精度
      amountPrecision: market.precision?.amount as number | undefined,
    };

    // 添加到结果
    symbols.push(info);
  }

  // 按符号排序
  symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));

  // 返回结果
  return symbols;
}

// ============================================================================
// K线数据获取
// ============================================================================

/**
 * 获取 K线数据
 *
 * @param exchange - CCXT 交易所实例
 * @param symbol - 交易对符号
 * @param since - 开始时间（毫秒）
 * @param limit - 每次获取数量（默认 1000）
 * @returns K线数据数组
 */
export async function fetchKlines(
  exchange: Exchange,
  symbol: string,
  since: number,
  limit: number = 1000
): Promise<RawKline[]> {
  try {
    // 使用 CCXT 的 fetchOHLCV 方法获取 K线
    // 时间周期固定为 1 分钟
    const ohlcv: OHLCV[] = await exchange.fetchOHLCV(
      symbol,      // 交易对
      '1m',        // 时间周期：1 分钟
      since,       // 开始时间
      limit        // 获取数量
    );

    // 转换为统一格式
    return ohlcv.map((candle) => ({
      // 开盘时间
      timestamp: candle[0] as number,
      // 开盘价
      open: candle[1] as number,
      // 最高价
      high: candle[2] as number,
      // 最低价
      low: candle[3] as number,
      // 收盘价
      close: candle[4] as number,
      // 成交量
      volume: candle[5] as number,
    }));

  } catch (error) {
    // 处理错误
    console.error(`[CCXT] Failed to fetch klines for ${symbol}:`, error);
    throw error;
  }
}

/**
 * 批量获取 K线数据（处理时间范围）
 * 自动分批获取并合并结果
 *
 * @param exchange - CCXT 交易所实例
 * @param symbol - 交易对符号
 * @param startTime - 开始时间（毫秒）
 * @param endTime - 结束时间（毫秒）
 * @param onProgress - 进度回调
 * @returns K线数据数组
 */
export async function fetchKlinesRange(
  exchange: Exchange,
  symbol: string,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void
): Promise<RawKline[]> {
  // 结果数组
  const allKlines: RawKline[] = [];

  // 当前获取位置
  let currentTime = startTime;

  // 每次获取的数量
  const limit = 1000;

  // 1 分钟的毫秒数
  const oneMinute = 60 * 1000;

  // 循环获取直到结束时间
  while (currentTime < endTime) {
    // 获取一批 K线
    const klines = await fetchKlines(exchange, symbol, currentTime, limit);

    // 如果没有数据，跳出循环
    if (klines.length === 0) {
      break;
    }

    // 过滤掉超出结束时间的数据
    const filtered = klines.filter((k) => k.timestamp < endTime);

    // 添加到结果
    allKlines.push(...filtered);

    // 更新当前位置（最后一条 K线时间 + 1 分钟）
    const lastTimestamp = klines[klines.length - 1]!.timestamp;
    currentTime = lastTimestamp + oneMinute;

    // 调用进度回调
    if (onProgress) {
      onProgress(currentTime, endTime);
    }

    // 如果获取的数据少于 limit，说明已经到达最新数据
    if (klines.length < limit) {
      break;
    }

    // 限速等待（避免触发交易所限制）
    await sleep(exchange.rateLimit || 100);
  }

  // 返回结果
  return allKlines;
}

// ============================================================================
// 资金费率数据获取
// ============================================================================

/**
 * 获取资金费率历史
 *
 * @param exchange - CCXT 交易所实例
 * @param exchangeId - 交易所 ID
 * @param symbol - 交易对符号
 * @param since - 开始时间（毫秒）
 * @param limit - 每次获取数量
 * @returns 资金费率数据数组
 */
export async function fetchFundingRateHistory(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  since: number,
  limit: number = 1000
): Promise<RawFundingRate[]> {
  try {
    // 不同交易所的 API 略有不同
    let fundingRates: RawFundingRate[] = [];

    // 根据交易所调用不同的方法
    switch (exchangeId) {
      case 'binance': {
        // Binance 使用 fetchFundingRateHistory
        const response = await exchange.fetchFundingRateHistory(symbol, since, limit);
        fundingRates = response.map((item: any) => ({
          timestamp: item.timestamp,
          symbol: item.symbol,
          fundingRate: item.fundingRate,
          markPrice: item.markPrice,
          indexPrice: item.indexPrice,
        }));
        break;
      }

      case 'bybit': {
        // Bybit 使用 fetchFundingRateHistory
        const response = await exchange.fetchFundingRateHistory(symbol, since, limit);
        fundingRates = response.map((item: any) => ({
          timestamp: item.timestamp,
          symbol: item.symbol,
          fundingRate: item.fundingRate,
          markPrice: item.markPrice,
        }));
        break;
      }

      case 'okx': {
        // OKX 使用 fetchFundingRateHistory
        const response = await exchange.fetchFundingRateHistory(symbol, since, limit);
        fundingRates = response.map((item: any) => ({
          timestamp: item.timestamp,
          symbol: item.symbol,
          fundingRate: item.fundingRate,
        }));
        break;
      }
    }

    return fundingRates;

  } catch (error) {
    console.error(`[CCXT] Failed to fetch funding rates for ${symbol}:`, error);
    throw error;
  }
}

/**
 * 批量获取资金费率历史（处理时间范围）
 *
 * @param exchange - CCXT 交易所实例
 * @param exchangeId - 交易所 ID
 * @param symbol - 交易对符号
 * @param startTime - 开始时间
 * @param endTime - 结束时间
 * @param onProgress - 进度回调
 * @returns 资金费率数据数组
 */
export async function fetchFundingRateHistoryRange(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void
): Promise<RawFundingRate[]> {
  // 结果数组
  const allRates: RawFundingRate[] = [];

  // 当前获取位置
  let currentTime = startTime;

  // 每次获取数量
  const limit = 1000;

  // 8 小时的毫秒数（资金费率结算周期）
  const eightHours = 8 * 60 * 60 * 1000;

  // 循环获取
  while (currentTime < endTime) {
    // 获取一批数据
    const rates = await fetchFundingRateHistory(
      exchange,
      exchangeId,
      symbol,
      currentTime,
      limit
    );

    // 如果没有数据，跳出
    if (rates.length === 0) {
      break;
    }

    // 过滤并添加
    const filtered = rates.filter((r) => r.timestamp < endTime);
    allRates.push(...filtered);

    // 更新位置
    const lastTimestamp = rates[rates.length - 1]!.timestamp;
    currentTime = lastTimestamp + eightHours;

    // 进度回调
    if (onProgress) {
      onProgress(currentTime, endTime);
    }

    // 如果数据量少于 limit，说明已到最新
    if (rates.length < limit) {
      break;
    }

    // 限速
    await sleep(exchange.rateLimit || 100);
  }

  return allRates;
}

// ============================================================================
// 标记价格数据获取
// ============================================================================

/**
 * 获取标记价格历史
 * 注意：大多数交易所不提供标记价格历史 API
 * 这里使用 K线数据中的价格作为替代
 *
 * @param exchange - CCXT 交易所实例
 * @param exchangeId - 交易所 ID
 * @param symbol - 交易对符号
 * @param since - 开始时间
 * @param limit - 获取数量
 * @returns 标记价格数据数组
 */
export async function fetchMarkPriceHistory(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  since: number,
  limit: number = 1000
): Promise<RawMarkPrice[]> {
  try {
    // 大多数交易所需要通过特定 API 获取
    // 这里尝试使用 CCXT 的 fetchMarkOHLCV（如果支持）
    let markPrices: RawMarkPrice[] = [];

    // 尝试获取标记价格 K线
    if (exchange.has['fetchMarkOHLCV']) {
      // 交易所支持标记价格 K线
      const ohlcv = await (exchange as any).fetchMarkOHLCV(symbol, '1m', since, limit);

      markPrices = ohlcv.map((candle: OHLCV) => ({
        timestamp: candle[0] as number,
        symbol,
        markPrice: candle[4] as number, // 使用收盘价作为标记价格
      }));

    } else {
      // 不支持标记价格历史，使用普通 K线的收盘价
      const ohlcv = await exchange.fetchOHLCV(symbol, '1m', since, limit);

      markPrices = ohlcv.map((candle: OHLCV) => ({
        timestamp: candle[0] as number,
        symbol,
        markPrice: candle[4] as number,
      }));
    }

    return markPrices;

  } catch (error) {
    console.error(`[CCXT] Failed to fetch mark prices for ${symbol}:`, error);
    throw error;
  }
}

/**
 * 批量获取标记价格历史
 */
export async function fetchMarkPriceHistoryRange(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void
): Promise<RawMarkPrice[]> {
  // 结果数组
  const allPrices: RawMarkPrice[] = [];

  // 当前位置
  let currentTime = startTime;

  // 每次获取数量
  const limit = 1000;

  // 1 分钟
  const oneMinute = 60 * 1000;

  // 循环获取
  while (currentTime < endTime) {
    const prices = await fetchMarkPriceHistory(
      exchange,
      exchangeId,
      symbol,
      currentTime,
      limit
    );

    if (prices.length === 0) {
      break;
    }

    const filtered = prices.filter((p) => p.timestamp < endTime);
    allPrices.push(...filtered);

    const lastTimestamp = prices[prices.length - 1]!.timestamp;
    currentTime = lastTimestamp + oneMinute;

    if (onProgress) {
      onProgress(currentTime, endTime);
    }

    if (prices.length < limit) {
      break;
    }

    await sleep(exchange.rateLimit || 100);
  }

  return allPrices;
}

// ============================================================================
// 持仓量数据获取
// ============================================================================

/**
 * 获取持仓量历史
 *
 * @param exchange - CCXT 交易所实例
 * @param exchangeId - 交易所 ID
 * @param symbol - 交易对符号
 * @param since - 开始时间
 * @param limit - 获取数量
 * @returns 持仓量数据数组
 */
export async function fetchOpenInterestHistory(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  since: number,
  limit: number = 500
): Promise<RawOpenInterest[]> {
  try {
    let openInterests: RawOpenInterest[] = [];

    // 根据交易所使用不同方法
    switch (exchangeId) {
      case 'binance': {
        // Binance 支持 fetchOpenInterestHistory
        if (exchange.has['fetchOpenInterestHistory']) {
          // 注意：Binance 的 OI 历史是按 5 分钟周期
          const response = await (exchange as any).fetchOpenInterestHistory(
            symbol,
            '5m',  // 时间周期
            since,
            limit
          );

          openInterests = response.map((item: any) => ({
            timestamp: item.timestamp,
            symbol: item.symbol,
            openInterest: item.openInterestAmount || item.openInterest,
            openInterestValue: item.openInterestValue,
          }));
        }
        break;
      }

      case 'bybit': {
        // Bybit 的 OI 历史
        if (exchange.has['fetchOpenInterestHistory']) {
          const response = await (exchange as any).fetchOpenInterestHistory(
            symbol,
            '5m',
            since,
            limit
          );

          openInterests = response.map((item: any) => ({
            timestamp: item.timestamp,
            symbol: item.symbol,
            openInterest: item.openInterestAmount || item.openInterest,
            openInterestValue: item.openInterestValue,
          }));
        }
        break;
      }

      case 'okx': {
        // OKX 的 OI 历史
        if (exchange.has['fetchOpenInterestHistory']) {
          const response = await (exchange as any).fetchOpenInterestHistory(
            symbol,
            '5m',
            since,
            limit
          );

          openInterests = response.map((item: any) => ({
            timestamp: item.timestamp,
            symbol: item.symbol,
            openInterest: item.openInterestAmount || item.openInterest,
            openInterestValue: item.openInterestValue,
          }));
        }
        break;
      }
    }

    return openInterests;

  } catch (error) {
    console.error(`[CCXT] Failed to fetch open interest for ${symbol}:`, error);
    throw error;
  }
}

/**
 * 批量获取持仓量历史
 */
export async function fetchOpenInterestHistoryRange(
  exchange: Exchange,
  exchangeId: ExchangeId,
  symbol: string,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void
): Promise<RawOpenInterest[]> {
  // 结果数组
  const allOI: RawOpenInterest[] = [];

  // 当前位置
  let currentTime = startTime;

  // 每次获取数量
  const limit = 500;

  // 5 分钟（OI 数据通常是 5 分钟周期）
  const fiveMinutes = 5 * 60 * 1000;

  // 循环获取
  while (currentTime < endTime) {
    const oi = await fetchOpenInterestHistory(
      exchange,
      exchangeId,
      symbol,
      currentTime,
      limit
    );

    if (oi.length === 0) {
      break;
    }

    const filtered = oi.filter((o) => o.timestamp < endTime);
    allOI.push(...filtered);

    const lastTimestamp = oi[oi.length - 1]!.timestamp;
    currentTime = lastTimestamp + fiveMinutes;

    if (onProgress) {
      onProgress(currentTime, endTime);
    }

    if (oi.length < limit) {
      break;
    }

    await sleep(exchange.rateLimit || 100);
  }

  return allOI;
}

// ============================================================================
// 聚合成交数据获取
// ============================================================================

/**
 * 获取聚合成交历史
 *
 * @param exchange - CCXT 交易所实例
 * @param symbol - 交易对符号
 * @param since - 开始时间
 * @param limit - 获取数量
 * @returns 聚合成交数据数组
 */
export async function fetchAggTrades(
  exchange: Exchange,
  symbol: string,
  since: number,
  limit: number = 1000
): Promise<RawAggTrade[]> {
  try {
    // 使用 CCXT 的 fetchTrades 方法
    const trades = await exchange.fetchTrades(symbol, since, limit);

    // 转换为统一格式
    return trades.map((trade) => ({
      id: trade.id,
      timestamp: trade.timestamp,
      symbol: trade.symbol,
      price: trade.price,
      amount: trade.amount,
      isBuyerMaker: trade.side === 'sell', // CCXT 中 side='sell' 表示买方主动
    }));

  } catch (error) {
    console.error(`[CCXT] Failed to fetch trades for ${symbol}:`, error);
    throw error;
  }
}

/**
 * 批量获取聚合成交历史
 * 注意：成交数据量很大，需要谨慎使用
 */
export async function fetchAggTradesRange(
  exchange: Exchange,
  symbol: string,
  startTime: number,
  endTime: number,
  onProgress?: (current: number, total: number) => void
): Promise<RawAggTrade[]> {
  // 结果数组
  const allTrades: RawAggTrade[] = [];

  // 当前位置
  let currentTime = startTime;

  // 每次获取数量
  const limit = 1000;

  // 循环获取
  while (currentTime < endTime) {
    const trades = await fetchAggTrades(exchange, symbol, currentTime, limit);

    if (trades.length === 0) {
      break;
    }

    const filtered = trades.filter((t) => t.timestamp < endTime);
    allTrades.push(...filtered);

    // 使用最后一笔成交的时间戳 + 1ms
    const lastTimestamp = trades[trades.length - 1]!.timestamp;
    currentTime = lastTimestamp + 1;

    if (onProgress) {
      onProgress(currentTime, endTime);
    }

    if (trades.length < limit) {
      break;
    }

    // 成交数据量大，增加限速延迟
    await sleep(exchange.rateLimit || 200);
  }

  return allTrades;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 延迟函数
 * @param ms - 延迟毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 获取交易对的上线时间
 * 用于确定数据下载的起始时间
 *
 * @param exchange - CCXT 交易所实例
 * @param symbol - 交易对符号
 * @returns 上线时间（毫秒）或 null
 */
export async function getSymbolListingDate(
  exchange: Exchange,
  symbol: string
): Promise<number | null> {
  try {
    // 加载市场信息
    await exchange.loadMarkets();

    // 获取市场信息
    const market = exchange.markets[symbol];

    // 如果有上线时间信息，返回
    if (market?.info?.onboardDate) {
      return parseInt(market.info.onboardDate, 10);
    }

    // 如果没有，尝试获取最早的 K线时间
    const klines = await exchange.fetchOHLCV(symbol, '1d', undefined, 1);
    if (klines.length > 0) {
      return klines[0]![0] as number;
    }

    return null;

  } catch (error) {
    console.error(`[CCXT] Failed to get listing date for ${symbol}:`, error);
    return null;
  }
}

/**
 * 检查交易所是否支持某个功能
 *
 * @param exchange - CCXT 交易所实例
 * @param feature - 功能名称
 * @returns 是否支持
 */
export function hasFeature(exchange: Exchange, feature: string): boolean {
  return exchange.has[feature] === true;
}
