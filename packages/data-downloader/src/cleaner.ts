// ============================================================================
// 数据清洗器
// 将原始数据转换为 ClickHouse 格式
// 包含数据验证、去重、异常值处理
// ============================================================================

import {
  type ExchangeId,
  type RawKline,
  type RawFundingRate,
  type RawMarkPrice,
  type RawOpenInterest,
  type RawAggTrade,
  type CleanKline,
  type CleanFundingRate,
  type CleanMarkPrice,
  type CleanOpenInterest,
  type CleanAggTrade,
} from './types.js';

// ============================================================================
// 数据验证函数
// ============================================================================

/**
 * 验证数字是否有效
 * 检查是否为有限数字且不为 NaN
 *
 * @param value - 要验证的值
 * @returns 是否有效
 */
function isValidNumber(value: unknown): value is number {
  // 检查是否为数字类型
  if (typeof value !== 'number') {
    return false;
  }

  // 检查是否为有限数字（非 NaN、非 Infinity）
  return Number.isFinite(value);
}

/**
 * 验证时间戳是否有效
 * 检查是否在合理范围内（2015-2100年）
 *
 * @param timestamp - 时间戳（毫秒）
 * @returns 是否有效
 */
function isValidTimestamp(timestamp: number): boolean {
  // 最小时间：2015年1月1日
  const minTime = new Date('2015-01-01').getTime();

  // 最大时间：2100年1月1日
  const maxTime = new Date('2100-01-01').getTime();

  // 检查范围
  return timestamp >= minTime && timestamp <= maxTime;
}

/**
 * 验证价格是否有效
 * 价格必须大于 0
 *
 * @param price - 价格
 * @returns 是否有效
 */
function isValidPrice(price: number): boolean {
  return isValidNumber(price) && price > 0;
}

/**
 * 验证数量是否有效
 * 数量必须大于等于 0
 *
 * @param amount - 数量
 * @returns 是否有效
 */
function isValidAmount(amount: number): boolean {
  return isValidNumber(amount) && amount >= 0;
}

// ============================================================================
// K线数据清洗
// ============================================================================

/**
 * 清洗 K线数据
 * 验证并转换为 ClickHouse 格式
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param raw - 原始 K线数据
 * @returns 清洗后的数据或 null（无效数据）
 */
export function cleanKline(
  exchange: ExchangeId,
  symbol: string,
  raw: RawKline
): CleanKline | null {
  // 验证时间戳
  if (!isValidTimestamp(raw.timestamp)) {
    console.warn(`[Cleaner] Invalid kline timestamp: ${raw.timestamp}`);
    return null;
  }

  // 验证 OHLC 价格
  if (!isValidPrice(raw.open) ||
      !isValidPrice(raw.high) ||
      !isValidPrice(raw.low) ||
      !isValidPrice(raw.close)) {
    console.warn(`[Cleaner] Invalid kline prices for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 验证成交量
  if (!isValidAmount(raw.volume)) {
    console.warn(`[Cleaner] Invalid kline volume for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 验证 OHLC 逻辑关系
  // 最高价必须大于等于最低价
  if (raw.high < raw.low) {
    console.warn(`[Cleaner] Invalid kline: high < low for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 开盘价和收盘价必须在最高最低价之间
  if (raw.open > raw.high || raw.open < raw.low ||
      raw.close > raw.high || raw.close < raw.low) {
    console.warn(`[Cleaner] Invalid kline: OHLC out of range for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 构建清洗后的数据
  return {
    // 交易所 ID
    exchange,
    // 交易对符号
    symbol,
    // 开盘时间（转换为 Date 对象）
    open_time: new Date(raw.timestamp),
    // 开盘价
    open: raw.open,
    // 最高价
    high: raw.high,
    // 最低价
    low: raw.low,
    // 收盘价
    close: raw.close,
    // 成交量
    volume: raw.volume,
    // 成交额（如果没有则设为 0）
    quote_volume: raw.quoteVolume || 0,
    // 成交笔数（如果没有则设为 0）
    trades: raw.trades || 0,
    // 数据版本（使用时间戳作为版本）
    version: raw.timestamp,
  };
}

/**
 * 批量清洗 K线数据
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param rawData - 原始数据数组
 * @returns 清洗后的数据数组
 */
export function cleanKlines(
  exchange: ExchangeId,
  symbol: string,
  rawData: RawKline[]
): CleanKline[] {
  // 结果数组
  const cleaned: CleanKline[] = [];

  // 用于去重的 Set
  const seen = new Set<number>();

  // 遍历原始数据
  for (const raw of rawData) {
    // 去重：检查时间戳是否已存在
    if (seen.has(raw.timestamp)) {
      continue;
    }

    // 清洗单条数据
    const clean = cleanKline(exchange, symbol, raw);

    // 如果有效，添加到结果
    if (clean) {
      cleaned.push(clean);
      seen.add(raw.timestamp);
    }
  }

  // 按时间排序
  cleaned.sort((a, b) => a.open_time.getTime() - b.open_time.getTime());

  return cleaned;
}

// ============================================================================
// 资金费率数据清洗
// ============================================================================

/**
 * 清洗资金费率数据
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param raw - 原始资金费率数据
 * @returns 清洗后的数据或 null
 */
export function cleanFundingRate(
  exchange: ExchangeId,
  symbol: string,
  raw: RawFundingRate
): CleanFundingRate | null {
  // 验证时间戳
  if (!isValidTimestamp(raw.timestamp)) {
    console.warn(`[Cleaner] Invalid funding rate timestamp: ${raw.timestamp}`);
    return null;
  }

  // 验证资金费率（资金费率可以为负数）
  if (!isValidNumber(raw.fundingRate)) {
    console.warn(`[Cleaner] Invalid funding rate value for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 资金费率通常在 -1% 到 +1% 之间（极端情况可能更大）
  // 这里设置 -10% 到 +10% 的范围作为异常值过滤
  if (raw.fundingRate < -0.1 || raw.fundingRate > 0.1) {
    console.warn(`[Cleaner] Funding rate out of range: ${raw.fundingRate} for ${symbol}`);
    // 不返回 null，只是警告，因为极端行情下可能出现高费率
  }

  // 构建清洗后的数据
  return {
    // 交易所 ID
    exchange,
    // 交易对符号
    symbol,
    // 结算时间
    funding_time: new Date(raw.timestamp),
    // 资金费率
    funding_rate: raw.fundingRate,
    // 标记价格（默认 0）
    mark_price: raw.markPrice || 0,
    // 指数价格（默认 0）
    index_price: raw.indexPrice || 0,
    // 版本
    version: raw.timestamp,
  };
}

/**
 * 批量清洗资金费率数据
 */
export function cleanFundingRates(
  exchange: ExchangeId,
  symbol: string,
  rawData: RawFundingRate[]
): CleanFundingRate[] {
  const cleaned: CleanFundingRate[] = [];
  const seen = new Set<number>();

  for (const raw of rawData) {
    // 去重
    if (seen.has(raw.timestamp)) {
      continue;
    }

    const clean = cleanFundingRate(exchange, symbol, raw);
    if (clean) {
      cleaned.push(clean);
      seen.add(raw.timestamp);
    }
  }

  // 按时间排序
  cleaned.sort((a, b) => a.funding_time.getTime() - b.funding_time.getTime());

  return cleaned;
}

// ============================================================================
// 标记价格数据清洗
// ============================================================================

/**
 * 清洗标记价格数据
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param raw - 原始标记价格数据
 * @returns 清洗后的数据或 null
 */
export function cleanMarkPrice(
  exchange: ExchangeId,
  symbol: string,
  raw: RawMarkPrice
): CleanMarkPrice | null {
  // 验证时间戳
  if (!isValidTimestamp(raw.timestamp)) {
    console.warn(`[Cleaner] Invalid mark price timestamp: ${raw.timestamp}`);
    return null;
  }

  // 验证标记价格
  if (!isValidPrice(raw.markPrice)) {
    console.warn(`[Cleaner] Invalid mark price for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 构建清洗后的数据
  return {
    // 交易所 ID
    exchange,
    // 交易对符号
    symbol,
    // 时间戳
    timestamp: new Date(raw.timestamp),
    // 标记价格
    mark_price: raw.markPrice,
    // 指数价格（默认为标记价格）
    index_price: raw.indexPrice || raw.markPrice,
    // 预估结算价格（默认为标记价格）
    estimated_settle_price: raw.estimatedSettlePrice || raw.markPrice,
    // 版本
    version: raw.timestamp,
  };
}

/**
 * 批量清洗标记价格数据
 */
export function cleanMarkPrices(
  exchange: ExchangeId,
  symbol: string,
  rawData: RawMarkPrice[]
): CleanMarkPrice[] {
  const cleaned: CleanMarkPrice[] = [];
  const seen = new Set<number>();

  for (const raw of rawData) {
    if (seen.has(raw.timestamp)) {
      continue;
    }

    const clean = cleanMarkPrice(exchange, symbol, raw);
    if (clean) {
      cleaned.push(clean);
      seen.add(raw.timestamp);
    }
  }

  cleaned.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return cleaned;
}

// ============================================================================
// 持仓量数据清洗
// ============================================================================

/**
 * 清洗持仓量数据
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param raw - 原始持仓量数据
 * @returns 清洗后的数据或 null
 */
export function cleanOpenInterest(
  exchange: ExchangeId,
  symbol: string,
  raw: RawOpenInterest
): CleanOpenInterest | null {
  // 验证时间戳
  if (!isValidTimestamp(raw.timestamp)) {
    console.warn(`[Cleaner] Invalid open interest timestamp: ${raw.timestamp}`);
    return null;
  }

  // 验证持仓量（必须非负）
  if (!isValidAmount(raw.openInterest)) {
    console.warn(`[Cleaner] Invalid open interest for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 构建清洗后的数据
  return {
    // 交易所 ID
    exchange,
    // 交易对符号
    symbol,
    // 时间戳
    timestamp: new Date(raw.timestamp),
    // 持仓量
    open_interest: raw.openInterest,
    // 持仓价值（默认 0）
    open_interest_value: raw.openInterestValue || 0,
    // 版本
    version: raw.timestamp,
  };
}

/**
 * 批量清洗持仓量数据
 */
export function cleanOpenInterests(
  exchange: ExchangeId,
  symbol: string,
  rawData: RawOpenInterest[]
): CleanOpenInterest[] {
  const cleaned: CleanOpenInterest[] = [];
  const seen = new Set<number>();

  for (const raw of rawData) {
    if (seen.has(raw.timestamp)) {
      continue;
    }

    const clean = cleanOpenInterest(exchange, symbol, raw);
    if (clean) {
      cleaned.push(clean);
      seen.add(raw.timestamp);
    }
  }

  cleaned.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return cleaned;
}

// ============================================================================
// 聚合成交数据清洗
// ============================================================================

/**
 * 清洗聚合成交数据
 *
 * @param exchange - 交易所 ID
 * @param symbol - 交易对符号
 * @param raw - 原始聚合成交数据
 * @returns 清洗后的数据或 null
 */
export function cleanAggTrade(
  exchange: ExchangeId,
  symbol: string,
  raw: RawAggTrade
): CleanAggTrade | null {
  // 验证时间戳
  if (!isValidTimestamp(raw.timestamp)) {
    console.warn(`[Cleaner] Invalid agg trade timestamp: ${raw.timestamp}`);
    return null;
  }

  // 验证价格
  if (!isValidPrice(raw.price)) {
    console.warn(`[Cleaner] Invalid agg trade price for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 验证数量
  if (!isValidAmount(raw.amount)) {
    console.warn(`[Cleaner] Invalid agg trade amount for ${symbol} at ${raw.timestamp}`);
    return null;
  }

  // 构建清洗后的数据
  return {
    // 交易所 ID
    exchange,
    // 交易对符号
    symbol,
    // 成交 ID（转为字符串）
    trade_id: String(raw.id),
    // 时间戳
    timestamp: new Date(raw.timestamp),
    // 价格
    price: raw.price,
    // 数量
    amount: raw.amount,
    // 方向：买方挂单成交 = -1（卖方主动），否则 = 1（买方主动）
    side: raw.isBuyerMaker ? -1 : 1,
    // 版本
    version: raw.timestamp,
  };
}

/**
 * 批量清洗聚合成交数据
 */
export function cleanAggTrades(
  exchange: ExchangeId,
  symbol: string,
  rawData: RawAggTrade[]
): CleanAggTrade[] {
  const cleaned: CleanAggTrade[] = [];
  const seen = new Set<string>();

  for (const raw of rawData) {
    // 使用 ID 去重
    const key = `${raw.id}-${raw.timestamp}`;
    if (seen.has(key)) {
      continue;
    }

    const clean = cleanAggTrade(exchange, symbol, raw);
    if (clean) {
      cleaned.push(clean);
      seen.add(key);
    }
  }

  cleaned.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return cleaned;
}

// ============================================================================
// 异常值检测
// ============================================================================

/**
 * 检测 K线数据中的异常值
 * 使用简单的统计方法检测价格跳跃
 *
 * @param klines - K线数据数组
 * @param threshold - 价格变化阈值（默认 50%）
 * @returns 异常值索引数组
 */
export function detectKlineAnomalies(
  klines: CleanKline[],
  threshold: number = 0.5
): number[] {
  // 异常索引数组
  const anomalies: number[] = [];

  // 至少需要 2 条数据
  if (klines.length < 2) {
    return anomalies;
  }

  // 遍历检测
  for (let i = 1; i < klines.length; i++) {
    // 当前 K线
    const current = klines[i]!;
    // 前一根 K线
    const previous = klines[i - 1]!;

    // 计算价格变化率
    const priceChange = Math.abs(current.close - previous.close) / previous.close;

    // 如果变化超过阈值，标记为异常
    if (priceChange > threshold) {
      anomalies.push(i);
    }
  }

  return anomalies;
}

/**
 * 填充缺失的 K线数据
 * 使用前一根 K线的收盘价填充
 *
 * @param klines - K线数据数组
 * @param interval - K线间隔（毫秒，默认 1 分钟）
 * @returns 填充后的 K线数组
 */
export function fillMissingKlines(
  klines: CleanKline[],
  interval: number = 60000
): CleanKline[] {
  // 如果数据为空，直接返回
  if (klines.length === 0) {
    return klines;
  }

  // 结果数组
  const filled: CleanKline[] = [];

  // 遍历填充
  for (let i = 0; i < klines.length; i++) {
    const current = klines[i]!;

    // 添加当前 K线
    filled.push(current);

    // 如果不是最后一根，检查是否有缺失
    if (i < klines.length - 1) {
      const next = klines[i + 1]!;
      const expectedNext = current.open_time.getTime() + interval;

      // 如果有时间间隙，填充缺失的 K线
      let fillTime = expectedNext;
      while (fillTime < next.open_time.getTime()) {
        // 创建填充的 K线（使用前一根的收盘价）
        const filledKline: CleanKline = {
          exchange: current.exchange,
          symbol: current.symbol,
          open_time: new Date(fillTime),
          open: current.close,
          high: current.close,
          low: current.close,
          close: current.close,
          volume: 0,
          quote_volume: 0,
          trades: 0,
          version: fillTime,
        };

        filled.push(filledKline);
        fillTime += interval;
      }
    }
  }

  return filled;
}

// ============================================================================
// 数据统计
// ============================================================================

/**
 * 计算 K线数据统计
 *
 * @param klines - K线数据数组
 * @returns 统计信息
 */
export function calculateKlineStats(klines: CleanKline[]): {
  count: number;
  minTime: Date | null;
  maxTime: Date | null;
  avgVolume: number;
  totalVolume: number;
  priceRange: { min: number; max: number } | null;
} {
  // 空数组返回默认值
  if (klines.length === 0) {
    return {
      count: 0,
      minTime: null,
      maxTime: null,
      avgVolume: 0,
      totalVolume: 0,
      priceRange: null,
    };
  }

  // 计算统计
  let totalVolume = 0;
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const kline of klines) {
    totalVolume += kline.volume;
    minPrice = Math.min(minPrice, kline.low);
    maxPrice = Math.max(maxPrice, kline.high);
  }

  return {
    count: klines.length,
    minTime: klines[0]!.open_time,
    maxTime: klines[klines.length - 1]!.open_time,
    avgVolume: totalVolume / klines.length,
    totalVolume,
    priceRange: { min: minPrice, max: maxPrice },
  };
}
