// ============================================================================
// 资金费率模拟器
// 精确模拟每8小时资金费率结算
// 根据持仓方向和资金费率计算费用
// ============================================================================

import {
  type ExchangeId,
  type FundingEvent,
  type Timestamp,
  getPositionKey,
} from './types.js';

import { AccountManager } from './account.js';

// ============================================================================
// 资金费率配置
// ============================================================================

// 资金费率配置
export interface FundingConfig {
  // 是否启用资金费率
  enabled: boolean;
  // 资金费率结算间隔（毫秒）
  settlementInterval: number;
  // 各交易所结算时间点（UTC 小时）
  settlementHours: Record<ExchangeId, number[]>;
}

// 默认资金费率配置
export const DEFAULT_FUNDING_CONFIG: FundingConfig = {
  // 启用资金费率
  enabled: true,
  // 8 小时结算一次
  settlementInterval: 8 * 60 * 60 * 1000,
  // 各交易所结算时间点（UTC）
  settlementHours: {
    // Binance: 00:00, 08:00, 16:00 UTC
    binance: [0, 8, 16],
    // Bybit: 00:00, 08:00, 16:00 UTC
    bybit: [0, 8, 16],
    // OKX: 00:00, 08:00, 16:00 UTC
    okx: [0, 8, 16],
  },
};

// ============================================================================
// 资金费率记录
// ============================================================================

// 资金费率记录
export interface FundingRecord {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 结算时间
  timestamp: Timestamp;
  // 资金费率
  fundingRate: number;
  // 标记价格
  markPrice: number;
  // 费用（正数为支出，负数为收入）
  fee: number;
  // 持仓数量
  positionQuantity: number;
  // 持仓方向
  positionSide: string;
}

// ============================================================================
// 资金费率缓存
// ============================================================================

// 资金费率缓存项
interface FundingRateCache {
  // 资金费率
  rate: number;
  // 标记价格
  markPrice: number;
  // 下次结算时间
  nextFundingTime: Timestamp;
  // 上次更新时间
  lastUpdateTime: Timestamp;
}

// ============================================================================
// 资金费率模拟器类
// ============================================================================

/**
 * 资金费率模拟器
 * 模拟交易所资金费率结算机制
 */
export class FundingSimulator {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: FundingConfig;

  // 账户管理器
  private accountManager: AccountManager;

  // 资金费率缓存（按 exchange:symbol 索引）
  private fundingRates: Map<string, FundingRateCache> = new Map();

  // 上次结算时间（按 exchange:symbol 索引）
  private lastSettlementTime: Map<string, Timestamp> = new Map();

  // 资金费用历史记录
  private fundingHistory: FundingRecord[] = [];

  // 当前时间戳
  private currentTimestamp: Timestamp = 0;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param accountManager - 账户管理器
   * @param config - 配置（可选）
   */
  constructor(
    accountManager: AccountManager,
    config?: Partial<FundingConfig>
  ) {
    // 保存账户管理器
    this.accountManager = accountManager;

    // 合并配置
    this.config = { ...DEFAULT_FUNDING_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 时间管理
  // ========================================================================

  /**
   * 设置当前时间戳
   * @param timestamp - 时间戳
   */
  setTimestamp(timestamp: Timestamp): void {
    this.currentTimestamp = timestamp;
  }

  /**
   * 获取当前时间戳
   */
  getTimestamp(): Timestamp {
    return this.currentTimestamp;
  }

  // ========================================================================
  // 公共方法 - 资金费率更新
  // ========================================================================

  /**
   * 处理资金费率事件
   * @param event - 资金费率事件
   * @returns 产生的费用（如果发生结算）
   */
  onFundingEvent(event: FundingEvent): number {
    // 更新时间戳
    this.currentTimestamp = event.timestamp;

    // 如果未启用资金费率，跳过
    if (!this.config.enabled) {
      return 0;
    }

    // 更新缓存
    const key = getPositionKey(event.exchange, event.symbol);
    this.fundingRates.set(key, {
      rate: event.fundingRate,
      markPrice: event.markPrice,
      nextFundingTime: event.nextFundingTime,
      lastUpdateTime: event.timestamp,
    });

    // 检查是否需要结算
    return this.checkAndSettleFunding(event.exchange, event.symbol, event.timestamp);
  }

  /**
   * 批量更新资金费率
   * @param rates - 资金费率映射（key: exchange:symbol）
   */
  updateFundingRates(
    rates: Map<string, { rate: number; markPrice: number; nextFundingTime: Timestamp }>
  ): void {
    // 遍历更新
    for (const [key, data] of rates) {
      this.fundingRates.set(key, {
        rate: data.rate,
        markPrice: data.markPrice,
        nextFundingTime: data.nextFundingTime,
        lastUpdateTime: this.currentTimestamp,
      });
    }
  }

  // ========================================================================
  // 公共方法 - 资金费率结算
  // ========================================================================

  /**
   * 检查并执行资金费率结算
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param timestamp - 当前时间戳
   * @returns 产生的费用
   */
  checkAndSettleFunding(
    exchange: ExchangeId,
    symbol: string,
    timestamp: Timestamp
  ): number {
    // 如果未启用资金费率，跳过
    if (!this.config.enabled) {
      return 0;
    }

    // 获取缓存
    const key = getPositionKey(exchange, symbol);
    const cache = this.fundingRates.get(key);

    // 没有资金费率数据，跳过
    if (!cache) {
      return 0;
    }

    // 检查是否到达结算时间
    if (!this.isSettlementTime(exchange, timestamp)) {
      return 0;
    }

    // 获取上次结算时间
    const lastSettlement = this.lastSettlementTime.get(key) ?? 0;

    // 计算上一个结算时间点
    const prevSettlementTime = this.getPreviousSettlementTime(exchange, timestamp);

    // 如果已经结算过，跳过
    if (lastSettlement >= prevSettlementTime) {
      return 0;
    }

    // 执行结算
    return this.settleFunding(exchange, symbol, cache.rate, cache.markPrice, timestamp);
  }

  /**
   * 强制执行资金费率结算（用于测试或手动触发）
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param fundingRate - 资金费率
   * @param markPrice - 标记价格
   * @returns 产生的费用
   */
  forceSettleFunding(
    exchange: ExchangeId,
    symbol: string,
    fundingRate: number,
    markPrice: number
  ): number {
    return this.settleFunding(exchange, symbol, fundingRate, markPrice, this.currentTimestamp);
  }

  /**
   * 检查所有持仓并结算资金费用
   * @param timestamp - 当前时间戳
   * @returns 总费用
   */
  settleAllFunding(timestamp: Timestamp): number {
    // 更新时间戳
    this.currentTimestamp = timestamp;

    // 如果未启用资金费率，跳过
    if (!this.config.enabled) {
      return 0;
    }

    // 总费用
    let totalFee = 0;

    // 遍历所有资金费率缓存
    for (const [key, cache] of this.fundingRates) {
      // 解析 key
      const [exchange, symbol] = key.split(':') as [ExchangeId, string];

      // 检查并结算
      const fee = this.checkAndSettleFunding(exchange, symbol, timestamp);
      totalFee += fee;
    }

    return totalFee;
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取资金费率
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getFundingRate(exchange: ExchangeId, symbol: string): number | undefined {
    const key = getPositionKey(exchange, symbol);
    return this.fundingRates.get(key)?.rate;
  }

  /**
   * 获取下次结算时间
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getNextFundingTime(exchange: ExchangeId, symbol: string): Timestamp | undefined {
    const key = getPositionKey(exchange, symbol);
    return this.fundingRates.get(key)?.nextFundingTime;
  }

  /**
   * 获取资金费用历史
   */
  getFundingHistory(): readonly FundingRecord[] {
    return this.fundingHistory;
  }

  /**
   * 获取指定交易对的资金费用历史
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getFundingHistoryBySymbol(exchange: ExchangeId, symbol: string): FundingRecord[] {
    return this.fundingHistory.filter(
      (record) => record.exchange === exchange && record.symbol === symbol
    );
  }

  /**
   * 获取总资金费用
   */
  getTotalFundingFee(): number {
    return this.fundingHistory.reduce((sum, record) => sum + record.fee, 0);
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有数据
   */
  clear(): void {
    this.fundingRates.clear();
    this.lastSettlementTime.clear();
    this.fundingHistory = [];
    this.currentTimestamp = 0;
  }

  /**
   * 重置历史记录（保留费率缓存）
   */
  resetHistory(): void {
    this.fundingHistory = [];
    this.lastSettlementTime.clear();
  }

  // ========================================================================
  // 私有方法 - 结算时间判断
  // ========================================================================

  /**
   * 判断是否为结算时间
   * @param exchange - 交易所
   * @param timestamp - 时间戳
   */
  private isSettlementTime(exchange: ExchangeId, timestamp: Timestamp): boolean {
    // 获取 UTC 日期对象
    const date = new Date(timestamp);

    // 获取 UTC 小时
    const hour = date.getUTCHours();

    // 获取分钟
    const minute = date.getUTCMinutes();

    // 获取该交易所的结算时间点
    const settlementHours = this.config.settlementHours[exchange] ?? [0, 8, 16];

    // 检查是否为结算小时（允许 5 分钟误差）
    for (const settlementHour of settlementHours) {
      if (hour === settlementHour && minute < 5) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取上一个结算时间点
   * @param exchange - 交易所
   * @param timestamp - 当前时间戳
   */
  private getPreviousSettlementTime(exchange: ExchangeId, timestamp: Timestamp): Timestamp {
    // 获取 UTC 日期
    const date = new Date(timestamp);
    const hour = date.getUTCHours();

    // 获取该交易所的结算时间点
    const settlementHours = this.config.settlementHours[exchange] ?? [0, 8, 16];

    // 找到最近的结算时间
    let prevHour = -1;
    for (const settlementHour of settlementHours.sort((a, b) => b - a)) {
      if (settlementHour <= hour) {
        prevHour = settlementHour;
        break;
      }
    }

    // 如果没找到（当前小时在所有结算小时之前），取前一天最后一个结算时间
    if (prevHour === -1) {
      prevHour = Math.max(...settlementHours);
      date.setUTCDate(date.getUTCDate() - 1);
    }

    // 设置时间为结算时间点
    date.setUTCHours(prevHour, 0, 0, 0);

    return date.getTime();
  }

  /**
   * 获取下一个结算时间点
   * @param exchange - 交易所
   * @param timestamp - 当前时间戳
   */
  private getNextSettlementTime(exchange: ExchangeId, timestamp: Timestamp): Timestamp {
    // 获取 UTC 日期
    const date = new Date(timestamp);
    const hour = date.getUTCHours();

    // 获取该交易所的结算时间点
    const settlementHours = this.config.settlementHours[exchange] ?? [0, 8, 16];

    // 找到下一个结算时间
    let nextHour = -1;
    for (const settlementHour of settlementHours.sort((a, b) => a - b)) {
      if (settlementHour > hour) {
        nextHour = settlementHour;
        break;
      }
    }

    // 如果没找到（当前小时在所有结算小时之后），取第二天第一个结算时间
    if (nextHour === -1) {
      nextHour = Math.min(...settlementHours);
      date.setUTCDate(date.getUTCDate() + 1);
    }

    // 设置时间为结算时间点
    date.setUTCHours(nextHour, 0, 0, 0);

    return date.getTime();
  }

  // ========================================================================
  // 私有方法 - 资金费用结算
  // ========================================================================

  /**
   * 执行资金费用结算
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param fundingRate - 资金费率
   * @param markPrice - 标记价格
   * @param timestamp - 结算时间
   */
  private settleFunding(
    exchange: ExchangeId,
    symbol: string,
    fundingRate: number,
    markPrice: number,
    timestamp: Timestamp
  ): number {
    // 获取持仓
    const position = this.accountManager.getPosition(exchange, symbol);

    // 没有持仓，跳过
    if (!position || position.side === 'none' || position.quantity === 0) {
      // 更新结算时间
      const key = getPositionKey(exchange, symbol);
      this.lastSettlementTime.set(key, timestamp);
      return 0;
    }

    // 调用账户管理器扣除资金费用
    const fee = this.accountManager.applyFundingFee(
      exchange,
      symbol,
      fundingRate,
      markPrice
    );

    // 记录历史
    this.fundingHistory.push({
      exchange,
      symbol,
      timestamp,
      fundingRate,
      markPrice,
      fee,
      positionQuantity: position.quantity,
      positionSide: position.side,
    });

    // 更新结算时间
    const key = getPositionKey(exchange, symbol);
    this.lastSettlementTime.set(key, timestamp);

    return fee;
  }
}

// ============================================================================
// 资金费率计算工具函数
// ============================================================================

/**
 * 计算预估资金费用
 * @param positionSide - 持仓方向（'long' | 'short'）
 * @param positionQuantity - 持仓数量
 * @param markPrice - 标记价格
 * @param fundingRate - 资金费率
 * @returns 预估费用（正数为支出，负数为收入）
 */
export function calculateFundingFee(
  positionSide: 'long' | 'short',
  positionQuantity: number,
  markPrice: number,
  fundingRate: number
): number {
  // 持仓价值
  const positionValue = positionQuantity * markPrice;

  // 多头：费率为正时支付，为负时收取
  // 空头：费率为正时收取，为负时支付
  if (positionSide === 'long') {
    return positionValue * fundingRate;
  } else {
    return -positionValue * fundingRate;
  }
}

/**
 * 获取下一个结算时间
 * @param exchange - 交易所
 * @param timestamp - 当前时间戳
 * @param config - 配置（可选）
 */
export function getNextSettlementTime(
  exchange: ExchangeId,
  timestamp: Timestamp,
  config?: Partial<FundingConfig>
): Timestamp {
  // 合并配置
  const cfg = { ...DEFAULT_FUNDING_CONFIG, ...config };

  // 获取 UTC 日期
  const date = new Date(timestamp);
  const hour = date.getUTCHours();

  // 获取该交易所的结算时间点
  const settlementHours = cfg.settlementHours[exchange] ?? [0, 8, 16];

  // 找到下一个结算时间
  let nextHour = -1;
  for (const settlementHour of settlementHours.sort((a, b) => a - b)) {
    if (settlementHour > hour) {
      nextHour = settlementHour;
      break;
    }
  }

  // 如果没找到，取第二天第一个结算时间
  if (nextHour === -1) {
    nextHour = Math.min(...settlementHours);
    date.setUTCDate(date.getUTCDate() + 1);
  }

  // 设置时间为结算时间点
  date.setUTCHours(nextHour, 0, 0, 0);

  return date.getTime();
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建资金费率模拟器
 * @param accountManager - 账户管理器
 * @param config - 配置
 */
export function createFundingSimulator(
  accountManager: AccountManager,
  config?: Partial<FundingConfig>
): FundingSimulator {
  return new FundingSimulator(accountManager, config);
}
