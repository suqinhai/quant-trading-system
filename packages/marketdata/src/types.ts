// ============================================================================
// 行情数据类型定义
// 定义所有市场数据相关的接口和类型
// ============================================================================

import type Decimal from 'decimal.js';

import type { ExchangeId, Symbol } from '@quant/exchange';

// ============================================================================
// K 线数据
// ============================================================================

/**
 * K 线时间周期
 * 定义常用的 K 线时间间隔
 */
export type KlineInterval =
  | '1m' // 1 分钟
  | '3m' // 3 分钟
  | '5m' // 5 分钟
  | '15m' // 15 分钟
  | '30m' // 30 分钟
  | '1h' // 1 小时
  | '2h' // 2 小时
  | '4h' // 4 小时
  | '6h' // 6 小时
  | '8h' // 8 小时
  | '12h' // 12 小时
  | '1d' // 1 天
  | '3d' // 3 天
  | '1w' // 1 周
  | '1M'; // 1 月

/**
 * K 线数据接口
 * 遵循 OHLCV（开高低收量）标准格式
 */
export interface Kline {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // K 线时间周期
  readonly interval: KlineInterval;

  // 开盘时间（毫秒时间戳）
  readonly openTime: number;

  // 收盘时间（毫秒时间戳）
  readonly closeTime: number;

  // 开盘价
  readonly open: Decimal;

  // 最高价
  readonly high: Decimal;

  // 最低价
  readonly low: Decimal;

  // 收盘价
  readonly close: Decimal;

  // 成交量（基础货币）
  readonly volume: Decimal;

  // 成交额（报价货币）
  readonly quoteVolume: Decimal;

  // 成交笔数
  readonly trades: number;

  // 主动买入成交量
  readonly takerBuyVolume: Decimal;

  // 主动买入成交额
  readonly takerBuyQuoteVolume: Decimal;

  // 是否为完整 K 线（未完成的 K 线会持续更新）
  readonly isFinal: boolean;
}

// ============================================================================
// 订单簿数据
// ============================================================================

/**
 * 价格档位
 * 表示订单簿中的单个价格级别
 */
export interface PriceLevel {
  // 价格
  readonly price: Decimal;

  // 数量
  readonly amount: Decimal;
}

/**
 * 订单簿快照
 * 完整的订单簿数据
 */
export interface OrderBook {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 买盘（按价格降序排列）
  readonly bids: readonly PriceLevel[];

  // 卖盘（按价格升序排列）
  readonly asks: readonly PriceLevel[];

  // 时间戳（毫秒）
  readonly timestamp: number;

  // 序列号（用于增量更新）
  readonly sequence?: number;

  /**
   * 获取最优买价
   */
  readonly bestBid: PriceLevel | undefined;

  /**
   * 获取最优卖价
   */
  readonly bestAsk: PriceLevel | undefined;

  /**
   * 获取买卖价差
   */
  readonly spread: Decimal | undefined;

  /**
   * 获取中间价
   */
  readonly midPrice: Decimal | undefined;
}

/**
 * 订单簿增量更新
 */
export interface OrderBookUpdate {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 更新类型：snapshot（快照）或 delta（增量）
  readonly type: 'snapshot' | 'delta';

  // 买盘更新
  readonly bids: readonly PriceLevel[];

  // 卖盘更新
  readonly asks: readonly PriceLevel[];

  // 时间戳
  readonly timestamp: number;

  // 起始序列号
  readonly firstUpdateId?: number;

  // 结束序列号
  readonly lastUpdateId?: number;
}

// ============================================================================
// 实时成交数据
// ============================================================================

/**
 * 实时成交（Tick）
 */
export interface Tick {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 成交 ID
  readonly id: string;

  // 成交价格
  readonly price: Decimal;

  // 成交数量
  readonly amount: Decimal;

  // 成交额
  readonly cost: Decimal;

  // 成交时间（毫秒时间戳）
  readonly timestamp: number;

  // 是否为买方主动成交
  readonly isBuyerMaker: boolean;

  // 是否为最优撮合
  readonly isBestMatch?: boolean;
}

/**
 * 聚合成交
 * 将多笔成交按价格聚合
 */
export interface AggTrade {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 聚合成交 ID
  readonly aggId: string;

  // 首个成交 ID
  readonly firstTradeId: string;

  // 最后成交 ID
  readonly lastTradeId: string;

  // 成交价格
  readonly price: Decimal;

  // 成交数量
  readonly amount: Decimal;

  // 成交时间
  readonly timestamp: number;

  // 是否为买方主动成交
  readonly isBuyerMaker: boolean;
}

// ============================================================================
// Ticker 数据
// ============================================================================

/**
 * 24 小时行情摘要
 */
export interface Ticker {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 最新价格
  readonly last: Decimal;

  // 最高价（24h）
  readonly high: Decimal;

  // 最低价（24h）
  readonly low: Decimal;

  // 开盘价（24h）
  readonly open: Decimal;

  // 收盘价
  readonly close: Decimal;

  // 成交量（24h）
  readonly volume: Decimal;

  // 成交额（24h）
  readonly quoteVolume: Decimal;

  // 涨跌幅
  readonly change: Decimal;

  // 涨跌幅百分比
  readonly changePercent: Decimal;

  // 加权平均价
  readonly vwap: Decimal;

  // 最优买价
  readonly bid: Decimal;

  // 最优买量
  readonly bidVolume: Decimal;

  // 最优卖价
  readonly ask: Decimal;

  // 最优卖量
  readonly askVolume: Decimal;

  // 时间戳
  readonly timestamp: number;
}

/**
 * 实时最新价格（简化版 Ticker）
 */
export interface MiniTicker {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 最新价格
  readonly price: Decimal;

  // 24h 涨跌幅
  readonly changePercent: Decimal;

  // 24h 成交量
  readonly volume: Decimal;

  // 时间戳
  readonly timestamp: number;
}

// ============================================================================
// 资金费率（期货）
// ============================================================================

/**
 * 资金费率
 */
export interface FundingRate {
  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // 资金费率
  readonly rate: Decimal;

  // 下次结算时间
  readonly nextFundingTime: number;

  // 标记价格
  readonly markPrice: Decimal;

  // 指数价格
  readonly indexPrice: Decimal;

  // 时间戳
  readonly timestamp: number;
}

// ============================================================================
// 订阅请求
// ============================================================================

/**
 * 订阅类型
 */
export type SubscriptionType =
  | 'kline' // K 线
  | 'orderbook' // 订单簿
  | 'trade' // 实时成交
  | 'ticker' // 24h 行情
  | 'miniTicker' // 简化行情
  | 'fundingRate'; // 资金费率

/**
 * 订阅请求
 */
export interface Subscription {
  // 订阅类型
  readonly type: SubscriptionType;

  // 交易对符号
  readonly symbol: Symbol;

  // 交易所标识
  readonly exchangeId: ExchangeId;

  // K 线周期（仅 kline 类型需要）
  readonly interval?: KlineInterval;

  // 订单簿深度（仅 orderbook 类型需要）
  readonly depth?: number;
}

/**
 * 订阅键生成
 * 用于唯一标识一个订阅
 */
export function getSubscriptionKey(sub: Subscription): string {
  let key = `${sub.exchangeId}:${sub.type}:${sub.symbol}`;

  // K 线需要包含周期
  if (sub.type === 'kline' && sub.interval) {
    key += `:${sub.interval}`;
  }

  // 订单簿需要包含深度
  if (sub.type === 'orderbook' && sub.depth) {
    key += `:${sub.depth}`;
  }

  return key;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * 行情引擎事件
 */
export interface MarketDataEvents {
  // K 线更新
  kline: (kline: Kline) => void;

  // 订单簿更新
  orderbook: (orderbook: OrderBook) => void;

  // 订单簿增量更新
  orderbookUpdate: (update: OrderBookUpdate) => void;

  // 实时成交
  trade: (trade: Tick) => void;

  // Ticker 更新
  ticker: (ticker: Ticker) => void;

  // 简化 Ticker 更新
  miniTicker: (ticker: MiniTicker) => void;

  // 资金费率更新
  fundingRate: (rate: FundingRate) => void;

  // 连接状态
  connected: (exchangeId: ExchangeId) => void;
  disconnected: (exchangeId: ExchangeId, reason: string) => void;
  reconnecting: (exchangeId: ExchangeId, attempt: number) => void;

  // 错误
  error: (error: Error) => void;
}
