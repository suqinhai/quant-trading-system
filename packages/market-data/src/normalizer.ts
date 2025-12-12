// ============================================================================
// 数据标准化器
// 将各交易所的原始 WebSocket 消息转换为统一格式
// 支持 Binance、Bybit、OKX 三个交易所
// ============================================================================

import {
  type ExchangeId,
  type UnifiedTicker,
  type UnifiedDepth,
  type UnifiedTrade,
  type UnifiedFundingRate,
  type UnifiedMarketData,
  type DepthLevel,
} from './types.js';

// ============================================================================
// 交易对符号转换
// ============================================================================

/**
 * 将交易所原始交易对符号转换为统一格式
 * 统一格式：BTC/USDT:USDT（表示 USDT 本位永续合约）
 *
 * @param exchange - 交易所 ID
 * @param rawSymbol - 原始交易对符号
 * @returns 统一格式的交易对符号
 */
export function normalizeSymbol(exchange: ExchangeId, rawSymbol: string): string {
  // 根据交易所转换符号
  switch (exchange) {
    case 'binance':
      // Binance: BTCUSDT -> BTC/USDT:USDT
      // 移除 USDT 后缀，添加统一格式
      if (rawSymbol.endsWith('USDT')) {
        // 获取基础货币（如 BTC）
        const base = rawSymbol.slice(0, -4);
        // 返回统一格式
        return `${base}/USDT:USDT`;
      }
      // 其他情况直接返回
      return rawSymbol;

    case 'bybit':
      // Bybit: BTCUSDT -> BTC/USDT:USDT
      // 格式与 Binance 相同
      if (rawSymbol.endsWith('USDT')) {
        // 获取基础货币
        const base = rawSymbol.slice(0, -4);
        // 返回统一格式
        return `${base}/USDT:USDT`;
      }
      // 其他情况直接返回
      return rawSymbol;

    case 'okx':
      // OKX: BTC-USDT-SWAP -> BTC/USDT:USDT
      // 分割符号
      const parts = rawSymbol.split('-');
      // 检查是否为永续合约
      if (parts.length >= 2 && parts[2] === 'SWAP') {
        // 返回统一格式
        return `${parts[0]}/${parts[1]}:${parts[1]}`;
      }
      // 其他情况直接返回
      return rawSymbol;

    default:
      // 未知交易所，直接返回
      return rawSymbol;
  }
}

/**
 * 将统一格式符号转换为交易所原始格式
 *
 * @param exchange - 交易所 ID
 * @param symbol - 统一格式符号（如 BTC/USDT:USDT）
 * @returns 交易所原始格式符号
 */
export function denormalizeSymbol(exchange: ExchangeId, symbol: string): string {
  // 解析统一格式：BTC/USDT:USDT
  // 提取基础货币和计价货币
  const match = symbol.match(/^([A-Z0-9]+)\/([A-Z]+):([A-Z]+)$/);

  // 如果不匹配统一格式，直接返回
  if (!match) {
    return symbol;
  }

  // 提取各部分
  const [, base, quote] = match;

  // 根据交易所转换
  switch (exchange) {
    case 'binance':
      // Binance: BTC/USDT:USDT -> BTCUSDT
      return `${base}${quote}`;

    case 'bybit':
      // Bybit: BTC/USDT:USDT -> BTCUSDT
      return `${base}${quote}`;

    case 'okx':
      // OKX: BTC/USDT:USDT -> BTC-USDT-SWAP
      return `${base}-${quote}-SWAP`;

    default:
      // 未知交易所，返回 Binance 格式
      return `${base}${quote}`;
  }
}

// ============================================================================
// 时间戳处理
// ============================================================================

/**
 * 计算统一时间戳
 * 使用交易所时间和本地接收时间的平均值
 *
 * @param exchangeTime - 交易所服务器时间（毫秒）
 * @param receivedAt - 本地接收时间（毫秒）
 * @returns 统一时间戳（毫秒）
 */
function calculateUnifiedTimestamp(exchangeTime: number, receivedAt: number): number {
  // 返回两者的平均值
  return Math.floor((exchangeTime + receivedAt) / 2);
}

// ============================================================================
// Binance 数据解析
// ============================================================================

/**
 * Binance Ticker 原始数据结构
 * 从 WebSocket 推送的 24hr ticker 数据
 */
interface BinanceTickerRaw {
  // 事件类型
  e: string;
  // 事件时间
  E: number;
  // 交易对
  s: string;
  // 价格变化百分比
  P: string;
  // 最新价格
  c: string;
  // 最高价
  h: string;
  // 最低价
  l: string;
  // 成交量（基础货币）
  v: string;
  // 成交额（计价货币）
  q: string;
  // 买一价
  b: string;
  // 买一量
  B: string;
  // 卖一价
  a: string;
  // 卖一量
  A: string;
}

/**
 * 解析 Binance Ticker 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Ticker 数据
 */
export function parseBinanceTicker(data: BinanceTickerRaw, receivedAt: number): UnifiedTicker {
  // 提取交易所时间
  const exchangeTime = data.E;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'ticker',
    // 交易所 ID
    exchange: 'binance',
    // 统一交易对符号
    symbol: normalizeSymbol('binance', data.s),
    // 原始交易对符号
    rawSymbol: data.s,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳（取平均）
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 最新价格
    last: parseFloat(data.c),
    // 买一价
    bid: parseFloat(data.b),
    // 买一量
    bidSize: parseFloat(data.B),
    // 卖一价
    ask: parseFloat(data.a),
    // 卖一量
    askSize: parseFloat(data.A),
    // 24 小时最高价
    high24h: parseFloat(data.h),
    // 24 小时最低价
    low24h: parseFloat(data.l),
    // 24 小时成交量
    volume24h: parseFloat(data.v),
    // 24 小时成交额
    turnover24h: parseFloat(data.q),
    // 24 小时涨跌幅
    change24h: parseFloat(data.P),
  };
}

/**
 * Binance Depth 原始数据结构
 * 从 WebSocket 推送的深度数据
 */
interface BinanceDepthRaw {
  // 事件类型
  e: string;
  // 事件时间
  E: number;
  // 交易时间
  T: number;
  // 交易对
  s: string;
  // 更新 ID（首个）
  U: number;
  // 更新 ID（最后）
  u: number;
  // 上一个更新 ID
  pu: number;
  // 买单列表 [[价格, 数量], ...]
  b: [string, string][];
  // 卖单列表 [[价格, 数量], ...]
  a: [string, string][];
}

/**
 * 解析 Binance Depth 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Depth 数据
 */
export function parseBinanceDepth(data: BinanceDepthRaw, receivedAt: number): UnifiedDepth {
  // 提取交易所时间
  const exchangeTime = data.E;

  // 转换买单列表
  const bids: DepthLevel[] = data.b.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 转换卖单列表
  const asks: DepthLevel[] = data.a.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'depth',
    // 交易所 ID
    exchange: 'binance',
    // 统一交易对符号
    symbol: normalizeSymbol('binance', data.s),
    // 原始交易对符号
    rawSymbol: data.s,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 买单列表（按价格降序）
    bids,
    // 卖单列表（按价格升序）
    asks,
    // 更新序号
    updateId: data.u,
  };
}

/**
 * Binance AggTrade 原始数据结构
 * 从 WebSocket 推送的聚合成交数据
 */
interface BinanceAggTradeRaw {
  // 事件类型
  e: string;
  // 事件时间
  E: number;
  // 交易对
  s: string;
  // 聚合交易 ID
  a: number;
  // 成交价格
  p: string;
  // 成交数量
  q: string;
  // 首个交易 ID
  f: number;
  // 最后交易 ID
  l: number;
  // 成交时间
  T: number;
  // 是否为买方挂单成交
  m: boolean;
}

/**
 * 解析 Binance AggTrade 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Trade 数据
 */
export function parseBinanceAggTrade(data: BinanceAggTradeRaw, receivedAt: number): UnifiedTrade {
  // 提取交易所时间（使用成交时间）
  const exchangeTime = data.T;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'trade',
    // 交易所 ID
    exchange: 'binance',
    // 统一交易对符号
    symbol: normalizeSymbol('binance', data.s),
    // 原始交易对符号
    rawSymbol: data.s,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 成交 ID（使用聚合 ID）
    tradeId: data.a.toString(),
    // 成交价格
    price: parseFloat(data.p),
    // 成交数量
    quantity: parseFloat(data.q),
    // 是否为买方挂单成交（买方 maker）
    isBuyerMaker: data.m,
  };
}

/**
 * Binance markPrice 原始数据结构
 * 包含资金费率信息
 */
interface BinanceMarkPriceRaw {
  // 事件类型
  e: string;
  // 事件时间
  E: number;
  // 交易对
  s: string;
  // 标记价格
  p: string;
  // 指数价格
  i: string;
  // 预估结算价格
  P: string;
  // 资金费率
  r: string;
  // 下次资金时间
  T: number;
}

/**
 * 解析 Binance 资金费率数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 FundingRate 数据
 */
export function parseBinanceFundingRate(
  data: BinanceMarkPriceRaw,
  receivedAt: number
): UnifiedFundingRate {
  // 提取交易所时间
  const exchangeTime = data.E;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'fundingRate',
    // 交易所 ID
    exchange: 'binance',
    // 统一交易对符号
    symbol: normalizeSymbol('binance', data.s),
    // 原始交易对符号
    rawSymbol: data.s,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 当前资金费率
    fundingRate: parseFloat(data.r),
    // 预测资金费率（Binance 不提供）
    nextFundingRate: null,
    // 下次结算时间
    nextFundingTime: data.T,
    // 标记价格
    markPrice: parseFloat(data.p),
    // 指数价格
    indexPrice: parseFloat(data.i),
  };
}

// ============================================================================
// Bybit 数据解析
// ============================================================================

/**
 * Bybit Ticker 原始数据结构
 * V5 API 的 tickers 推送
 */
interface BybitTickerRaw {
  // 主题
  topic: string;
  // 类型
  type: string;
  // 数据
  data: {
    // 交易对
    symbol: string;
    // 最新价格
    lastPrice: string;
    // 24 小时涨跌幅
    price24hPcnt: string;
    // 24 小时最高价
    highPrice24h: string;
    // 24 小时最低价
    lowPrice24h: string;
    // 24 小时成交量
    volume24h: string;
    // 24 小时成交额
    turnover24h: string;
    // 买一价
    bid1Price: string;
    // 买一量
    bid1Size: string;
    // 卖一价
    ask1Price: string;
    // 卖一量
    ask1Size: string;
  };
  // 时间戳
  ts: number;
}

/**
 * 解析 Bybit Ticker 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Ticker 数据
 */
export function parseBybitTicker(data: BybitTickerRaw, receivedAt: number): UnifiedTicker {
  // 提取数据部分
  const d = data.data;
  // 提取交易所时间
  const exchangeTime = data.ts;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'ticker',
    // 交易所 ID
    exchange: 'bybit',
    // 统一交易对符号
    symbol: normalizeSymbol('bybit', d.symbol),
    // 原始交易对符号
    rawSymbol: d.symbol,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 最新价格
    last: parseFloat(d.lastPrice),
    // 买一价
    bid: parseFloat(d.bid1Price),
    // 买一量
    bidSize: parseFloat(d.bid1Size),
    // 卖一价
    ask: parseFloat(d.ask1Price),
    // 卖一量
    askSize: parseFloat(d.ask1Size),
    // 24 小时最高价
    high24h: parseFloat(d.highPrice24h),
    // 24 小时最低价
    low24h: parseFloat(d.lowPrice24h),
    // 24 小时成交量
    volume24h: parseFloat(d.volume24h),
    // 24 小时成交额
    turnover24h: parseFloat(d.turnover24h),
    // 24 小时涨跌幅（转换为百分比）
    change24h: parseFloat(d.price24hPcnt) * 100,
  };
}

/**
 * Bybit Depth 原始数据结构
 * V5 API 的 orderbook 推送
 */
interface BybitDepthRaw {
  // 主题
  topic: string;
  // 类型（snapshot/delta）
  type: string;
  // 时间戳
  ts: number;
  // 数据
  data: {
    // 交易对
    s: string;
    // 买单列表 [[价格, 数量], ...]
    b: [string, string][];
    // 卖单列表 [[价格, 数量], ...]
    a: [string, string][];
    // 更新 ID
    u: number;
    // 序号
    seq: number;
  };
}

/**
 * 解析 Bybit Depth 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Depth 数据
 */
export function parseBybitDepth(data: BybitDepthRaw, receivedAt: number): UnifiedDepth {
  // 提取数据部分
  const d = data.data;
  // 提取交易所时间
  const exchangeTime = data.ts;

  // 转换买单列表
  const bids: DepthLevel[] = d.b.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 转换卖单列表
  const asks: DepthLevel[] = d.a.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'depth',
    // 交易所 ID
    exchange: 'bybit',
    // 统一交易对符号
    symbol: normalizeSymbol('bybit', d.s),
    // 原始交易对符号
    rawSymbol: d.s,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 买单列表
    bids,
    // 卖单列表
    asks,
    // 更新序号
    updateId: d.u,
  };
}

/**
 * Bybit Trade 原始数据结构
 * V5 API 的 publicTrade 推送
 */
interface BybitTradeRaw {
  // 主题
  topic: string;
  // 类型
  type: string;
  // 时间戳
  ts: number;
  // 数据（数组）
  data: Array<{
    // 成交 ID
    i: string;
    // 成交时间
    T: number;
    // 成交价格
    p: string;
    // 成交数量
    v: string;
    // 方向（Buy/Sell）
    S: string;
    // 交易对
    s: string;
    // 是否为大宗交易
    BT: boolean;
  }>;
}

/**
 * 解析 Bybit Trade 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Trade 数据数组
 */
export function parseBybitTrades(data: BybitTradeRaw, receivedAt: number): UnifiedTrade[] {
  // 遍历所有成交记录
  return data.data.map((trade) => {
    // 提取交易所时间
    const exchangeTime = trade.T;

    // 构建统一格式数据
    return {
      // 数据类型
      type: 'trade' as const,
      // 交易所 ID
      exchange: 'bybit' as const,
      // 统一交易对符号
      symbol: normalizeSymbol('bybit', trade.s),
      // 原始交易对符号
      rawSymbol: trade.s,
      // 交易所时间
      exchangeTime,
      // 本地接收时间
      receivedAt,
      // 统一时间戳
      timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
      // 成交 ID
      tradeId: trade.i,
      // 成交价格
      price: parseFloat(trade.p),
      // 成交数量
      quantity: parseFloat(trade.v),
      // 是否为买方挂单成交（Sell 表示卖方主动，即买方 maker）
      isBuyerMaker: trade.S === 'Sell',
    };
  });
}

/**
 * Bybit Ticker 原始数据结构（包含资金费率）
 * V5 API 的 tickers 推送
 */
interface BybitTickerWithFundingRaw {
  // 主题
  topic: string;
  // 类型
  type: string;
  // 数据
  data: {
    // 交易对
    symbol: string;
    // 资金费率
    fundingRate: string;
    // 下次资金时间
    nextFundingTime: string;
    // 标记价格
    markPrice: string;
    // 指数价格
    indexPrice: string;
  };
  // 时间戳
  ts: number;
}

/**
 * 解析 Bybit 资金费率数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 FundingRate 数据
 */
export function parseBybitFundingRate(
  data: BybitTickerWithFundingRaw,
  receivedAt: number
): UnifiedFundingRate {
  // 提取数据部分
  const d = data.data;
  // 提取交易所时间
  const exchangeTime = data.ts;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'fundingRate',
    // 交易所 ID
    exchange: 'bybit',
    // 统一交易对符号
    symbol: normalizeSymbol('bybit', d.symbol),
    // 原始交易对符号
    rawSymbol: d.symbol,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 当前资金费率
    fundingRate: parseFloat(d.fundingRate),
    // 预测资金费率（Bybit 不提供）
    nextFundingRate: null,
    // 下次结算时间
    nextFundingTime: parseInt(d.nextFundingTime, 10),
    // 标记价格
    markPrice: parseFloat(d.markPrice),
    // 指数价格
    indexPrice: parseFloat(d.indexPrice),
  };
}

// ============================================================================
// OKX 数据解析
// ============================================================================

/**
 * OKX Ticker 原始数据结构
 * V5 API 的 tickers 推送
 */
interface OkxTickerRaw {
  // 参数
  arg: {
    // 频道
    channel: string;
    // 产品 ID
    instId: string;
  };
  // 数据
  data: Array<{
    // 产品 ID
    instId: string;
    // 最新价格
    last: string;
    // 24 小时最高价
    high24h: string;
    // 24 小时最低价
    low24h: string;
    // 24 小时成交量（基础货币）
    vol24h: string;
    // 24 小时成交额（计价货币）
    volCcy24h: string;
    // 买一价
    bidPx: string;
    // 买一量
    bidSz: string;
    // 卖一价
    askPx: string;
    // 卖一量
    askSz: string;
    // 时间戳
    ts: string;
  }>;
}

/**
 * 解析 OKX Ticker 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Ticker 数据
 */
export function parseOkxTicker(data: OkxTickerRaw, receivedAt: number): UnifiedTicker | null {
  // 检查数据是否存在
  if (!data.data || data.data.length === 0) {
    return null;
  }

  // 取第一条数据
  const d = data.data[0]!;
  // 提取交易所时间
  const exchangeTime = parseInt(d.ts, 10);

  // 计算 24 小时涨跌幅（OKX 不直接提供，需要从其他数据计算）
  // 这里简化处理，设为 0
  const change24h = 0;

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'ticker',
    // 交易所 ID
    exchange: 'okx',
    // 统一交易对符号
    symbol: normalizeSymbol('okx', d.instId),
    // 原始交易对符号
    rawSymbol: d.instId,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 最新价格
    last: parseFloat(d.last),
    // 买一价
    bid: parseFloat(d.bidPx),
    // 买一量
    bidSize: parseFloat(d.bidSz),
    // 卖一价
    ask: parseFloat(d.askPx),
    // 卖一量
    askSize: parseFloat(d.askSz),
    // 24 小时最高价
    high24h: parseFloat(d.high24h),
    // 24 小时最低价
    low24h: parseFloat(d.low24h),
    // 24 小时成交量
    volume24h: parseFloat(d.vol24h),
    // 24 小时成交额
    turnover24h: parseFloat(d.volCcy24h),
    // 24 小时涨跌幅
    change24h,
  };
}

/**
 * OKX Depth 原始数据结构
 * V5 API 的 books 推送
 */
interface OkxDepthRaw {
  // 参数
  arg: {
    // 频道
    channel: string;
    // 产品 ID
    instId: string;
  };
  // 动作（snapshot/update）
  action: string;
  // 数据
  data: Array<{
    // 买单列表 [[价格, 数量, 废弃, 订单数], ...]
    bids: [string, string, string, string][];
    // 卖单列表
    asks: [string, string, string, string][];
    // 时间戳
    ts: string;
    // 校验和
    checksum: number;
  }>;
}

/**
 * 解析 OKX Depth 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Depth 数据
 */
export function parseOkxDepth(data: OkxDepthRaw, receivedAt: number): UnifiedDepth | null {
  // 检查数据是否存在
  if (!data.data || data.data.length === 0) {
    return null;
  }

  // 取第一条数据
  const d = data.data[0]!;
  // 提取交易所时间
  const exchangeTime = parseInt(d.ts, 10);

  // 转换买单列表（只取价格和数量）
  const bids: DepthLevel[] = d.bids.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 转换卖单列表
  const asks: DepthLevel[] = d.asks.map(([price, qty]) => [
    parseFloat(price),
    parseFloat(qty),
  ]);

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'depth',
    // 交易所 ID
    exchange: 'okx',
    // 统一交易对符号
    symbol: normalizeSymbol('okx', data.arg.instId),
    // 原始交易对符号
    rawSymbol: data.arg.instId,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 买单列表
    bids,
    // 卖单列表
    asks,
    // 更新序号（使用校验和作为替代）
    updateId: d.checksum,
  };
}

/**
 * OKX Trade 原始数据结构
 * V5 API 的 trades 推送
 */
interface OkxTradeRaw {
  // 参数
  arg: {
    // 频道
    channel: string;
    // 产品 ID
    instId: string;
  };
  // 数据
  data: Array<{
    // 产品 ID
    instId: string;
    // 成交 ID
    tradeId: string;
    // 成交价格
    px: string;
    // 成交数量
    sz: string;
    // 方向（buy/sell）
    side: string;
    // 时间戳
    ts: string;
  }>;
}

/**
 * 解析 OKX Trade 数据
 *
 * @param data - 原始数据
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 Trade 数据数组
 */
export function parseOkxTrades(data: OkxTradeRaw, receivedAt: number): UnifiedTrade[] {
  // 检查数据是否存在
  if (!data.data || data.data.length === 0) {
    return [];
  }

  // 遍历所有成交记录
  return data.data.map((trade) => {
    // 提取交易所时间
    const exchangeTime = parseInt(trade.ts, 10);

    // 构建统一格式数据
    return {
      // 数据类型
      type: 'trade' as const,
      // 交易所 ID
      exchange: 'okx' as const,
      // 统一交易对符号
      symbol: normalizeSymbol('okx', trade.instId),
      // 原始交易对符号
      rawSymbol: trade.instId,
      // 交易所时间
      exchangeTime,
      // 本地接收时间
      receivedAt,
      // 统一时间戳
      timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
      // 成交 ID
      tradeId: trade.tradeId,
      // 成交价格
      price: parseFloat(trade.px),
      // 成交数量
      quantity: parseFloat(trade.sz),
      // 是否为买方挂单成交（sell 表示卖方主动，即买方 maker）
      isBuyerMaker: trade.side === 'sell',
    };
  });
}

/**
 * OKX FundingRate 原始数据结构
 * V5 API 的 funding-rate 推送
 */
interface OkxFundingRateRaw {
  // 参数
  arg: {
    // 频道
    channel: string;
    // 产品 ID
    instId: string;
  };
  // 数据
  data: Array<{
    // 产品 ID
    instId: string;
    // 资金费率
    fundingRate: string;
    // 下次资金费率
    nextFundingRate: string;
    // 资金时间
    fundingTime: string;
    // 下次资金时间
    nextFundingTime: string;
  }>;
}

/**
 * OKX MarkPrice 原始数据结构
 * V5 API 的 mark-price 推送
 */
interface OkxMarkPriceRaw {
  // 参数
  arg: {
    // 频道
    channel: string;
    // 产品 ID
    instId: string;
  };
  // 数据
  data: Array<{
    // 产品 ID
    instId: string;
    // 标记价格
    markPx: string;
    // 时间戳
    ts: string;
  }>;
}

/**
 * 解析 OKX 资金费率数据
 *
 * @param fundingData - 资金费率原始数据
 * @param markData - 标记价格原始数据（可选）
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的 FundingRate 数据
 */
export function parseOkxFundingRate(
  fundingData: OkxFundingRateRaw,
  markData: OkxMarkPriceRaw | null,
  receivedAt: number
): UnifiedFundingRate | null {
  // 检查数据是否存在
  if (!fundingData.data || fundingData.data.length === 0) {
    return null;
  }

  // 取第一条数据
  const d = fundingData.data[0]!;
  // 提取交易所时间
  const exchangeTime = parseInt(d.fundingTime, 10);

  // 获取标记价格（如果有）
  let markPrice = 0;
  let indexPrice = 0;
  if (markData && markData.data && markData.data.length > 0) {
    markPrice = parseFloat(markData.data[0]!.markPx);
    // OKX 不在此频道提供指数价格，设为与标记价格相同
    indexPrice = markPrice;
  }

  // 构建统一格式数据
  return {
    // 数据类型
    type: 'fundingRate',
    // 交易所 ID
    exchange: 'okx',
    // 统一交易对符号
    symbol: normalizeSymbol('okx', d.instId),
    // 原始交易对符号
    rawSymbol: d.instId,
    // 交易所时间
    exchangeTime,
    // 本地接收时间
    receivedAt,
    // 统一时间戳
    timestamp: calculateUnifiedTimestamp(exchangeTime, receivedAt),
    // 当前资金费率
    fundingRate: parseFloat(d.fundingRate),
    // 预测资金费率
    nextFundingRate: d.nextFundingRate ? parseFloat(d.nextFundingRate) : null,
    // 下次结算时间
    nextFundingTime: parseInt(d.nextFundingTime, 10),
    // 标记价格
    markPrice,
    // 指数价格
    indexPrice,
  };
}

// ============================================================================
// 统一消息解析器
// ============================================================================

/**
 * 解析 Binance 组合流消息
 * Binance 的组合流格式：{ stream: "xxx", data: {...} }
 *
 * @param message - 原始 JSON 字符串
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的市场数据（数组）
 */
export function parseBinanceMessage(
  message: string,
  receivedAt: number
): UnifiedMarketData[] {
  // 解析结果数组
  const results: UnifiedMarketData[] = [];

  try {
    // 解析 JSON
    const parsed = JSON.parse(message);

    // 检查是否为组合流格式
    if (!parsed.stream || !parsed.data) {
      return results;
    }

    // 获取流名称和数据
    const stream = parsed.stream as string;
    const data = parsed.data;

    // 根据流名称判断数据类型
    if (stream.includes('@ticker')) {
      // Ticker 数据
      const ticker = parseBinanceTicker(data, receivedAt);
      results.push(ticker);

    } else if (stream.includes('@depth')) {
      // Depth 数据
      const depth = parseBinanceDepth(data, receivedAt);
      results.push(depth);

    } else if (stream.includes('@aggTrade')) {
      // AggTrade 数据
      const trade = parseBinanceAggTrade(data, receivedAt);
      results.push(trade);

    } else if (stream.includes('@markPrice')) {
      // 资金费率数据
      const funding = parseBinanceFundingRate(data, receivedAt);
      results.push(funding);
    }

  } catch (error) {
    // 解析失败，忽略此消息
    console.error('Failed to parse Binance message:', error);
  }

  // 返回解析结果
  return results;
}

/**
 * 解析 Bybit V5 消息
 *
 * @param message - 原始 JSON 字符串
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的市场数据（数组）
 */
export function parseBybitMessage(
  message: string,
  receivedAt: number
): UnifiedMarketData[] {
  // 解析结果数组
  const results: UnifiedMarketData[] = [];

  try {
    // 解析 JSON
    const parsed = JSON.parse(message);

    // 检查是否有 topic 字段
    if (!parsed.topic) {
      return results;
    }

    // 获取主题
    const topic = parsed.topic as string;

    // 根据主题判断数据类型
    if (topic.startsWith('tickers.')) {
      // Ticker 数据
      const ticker = parseBybitTicker(parsed, receivedAt);
      results.push(ticker);

      // 如果包含资金费率字段，也解析资金费率
      if (parsed.data?.fundingRate) {
        const funding = parseBybitFundingRate(parsed, receivedAt);
        results.push(funding);
      }

    } else if (topic.startsWith('orderbook.')) {
      // Depth 数据
      const depth = parseBybitDepth(parsed, receivedAt);
      results.push(depth);

    } else if (topic.startsWith('publicTrade.')) {
      // Trade 数据（可能有多条）
      const trades = parseBybitTrades(parsed, receivedAt);
      results.push(...trades);
    }

  } catch (error) {
    // 解析失败，忽略此消息
    console.error('Failed to parse Bybit message:', error);
  }

  // 返回解析结果
  return results;
}

/**
 * 解析 OKX V5 消息
 *
 * @param message - 原始 JSON 字符串
 * @param receivedAt - 本地接收时间
 * @returns 统一格式的市场数据（数组）
 */
export function parseOkxMessage(
  message: string,
  receivedAt: number
): UnifiedMarketData[] {
  // 解析结果数组
  const results: UnifiedMarketData[] = [];

  try {
    // 解析 JSON
    const parsed = JSON.parse(message);

    // 检查是否有 arg 字段
    if (!parsed.arg || !parsed.arg.channel) {
      return results;
    }

    // 获取频道
    const channel = parsed.arg.channel as string;

    // 根据频道判断数据类型
    if (channel === 'tickers') {
      // Ticker 数据
      const ticker = parseOkxTicker(parsed, receivedAt);
      if (ticker) {
        results.push(ticker);
      }

    } else if (channel.startsWith('books')) {
      // Depth 数据（books5, books 等）
      const depth = parseOkxDepth(parsed, receivedAt);
      if (depth) {
        results.push(depth);
      }

    } else if (channel === 'trades') {
      // Trade 数据
      const trades = parseOkxTrades(parsed, receivedAt);
      results.push(...trades);

    } else if (channel === 'funding-rate') {
      // 资金费率数据
      const funding = parseOkxFundingRate(parsed, null, receivedAt);
      if (funding) {
        results.push(funding);
      }
    }

  } catch (error) {
    // 解析失败，忽略此消息
    console.error('Failed to parse OKX message:', error);
  }

  // 返回解析结果
  return results;
}

/**
 * 统一消息解析入口
 * 根据交易所 ID 调用对应的解析器
 *
 * @param exchange - 交易所 ID
 * @param message - 原始 JSON 字符串
 * @param receivedAt - 本地接收时间（可选，默认当前时间）
 * @returns 统一格式的市场数据（数组）
 */
export function parseMessage(
  exchange: ExchangeId,
  message: string,
  receivedAt: number = Date.now()
): UnifiedMarketData[] {
  // 根据交易所调用对应解析器
  switch (exchange) {
    case 'binance':
      return parseBinanceMessage(message, receivedAt);

    case 'bybit':
      return parseBybitMessage(message, receivedAt);

    case 'okx':
      return parseOkxMessage(message, receivedAt);

    default:
      // 未知交易所，返回空数组
      return [];
  }
}
