// ============================================================================
// 风控类型定义
// 定义风险管理相关的接口和类型
// ============================================================================

import type Decimal from 'decimal.js';

import type { OrderRequest, Position, Symbol } from '@quant/exchange';

// ============================================================================
// 风控规则类型
// ============================================================================

/**
 * 风控检查结果
 */
export interface RiskCheckResult {
  // 是否通过
  readonly passed: boolean;

  // 拒绝原因（如果未通过）
  readonly reason?: string;

  // 风控规则名称
  readonly ruleName: string;

  // 风险等级
  readonly riskLevel: RiskLevel;

  // 建议的修改（如果有）
  readonly suggestion?: OrderModification;
}

/**
 * 风险等级
 */
export enum RiskLevel {
  LOW = 'LOW', // 低风险
  MEDIUM = 'MEDIUM', // 中等风险
  HIGH = 'HIGH', // 高风险
  CRITICAL = 'CRITICAL', // 严重风险
}

/**
 * 订单修改建议
 */
export interface OrderModification {
  // 建议的数量
  readonly amount?: Decimal;

  // 建议的价格
  readonly price?: Decimal;

  // 建议添加的止损
  readonly stopLoss?: Decimal;

  // 建议添加的止盈
  readonly takeProfit?: Decimal;
}

// ============================================================================
// 风控配置
// ============================================================================

/**
 * 仓位限制配置
 */
export interface PositionLimits {
  // 单个交易对最大仓位（占总资金比例）
  readonly maxPositionSizePercent: Decimal;

  // 单个交易对最大持仓数量
  readonly maxPositionAmount?: Decimal;

  // 最大同时持仓数量
  readonly maxOpenPositions: number;

  // 单个方向最大仓位（多/空）
  readonly maxDirectionalExposure: Decimal;

  // 总仓位限制（占总资金比例）
  readonly maxTotalExposure: Decimal;
}

/**
 * 订单限制配置
 */
export interface OrderLimits {
  // 单笔订单最大金额
  readonly maxOrderValue: Decimal;

  // 单笔订单最小金额
  readonly minOrderValue: Decimal;

  // 每分钟最大订单数
  readonly maxOrdersPerMinute: number;

  // 每小时最大订单数
  readonly maxOrdersPerHour: number;

  // 是否要求止损
  readonly requireStopLoss: boolean;

  // 最大滑点容忍度（百分比）
  readonly maxSlippage: Decimal;
}

/**
 * 亏损限制配置
 */
export interface LossLimits {
  // 单笔最大亏损（占总资金比例）
  readonly maxLossPerTrade: Decimal;

  // 每日最大亏损
  readonly maxDailyLoss: Decimal;

  // 每周最大亏损
  readonly maxWeeklyLoss: Decimal;

  // 最大回撤
  readonly maxDrawdown: Decimal;

  // 连续亏损次数限制
  readonly maxConsecutiveLosses: number;
}

/**
 * 完整风控配置
 */
export interface RiskConfig {
  // 仓位限制
  readonly positionLimits: PositionLimits;

  // 订单限制
  readonly orderLimits: OrderLimits;

  // 亏损限制
  readonly lossLimits: LossLimits;

  // 是否启用熔断
  readonly enableCircuitBreaker: boolean;

  // 熔断后冷却时间（毫秒）
  readonly circuitBreakerCooldown: number;

  // 白名单交易对
  readonly symbolWhitelist?: Symbol[];

  // 黑名单交易对
  readonly symbolBlacklist?: Symbol[];
}

// ============================================================================
// 风控状态
// ============================================================================

/**
 * 风控状态
 */
export interface RiskState {
  // 当前权益
  readonly equity: Decimal;

  // 当日起始权益
  readonly dailyStartEquity: Decimal;

  // 本周起始权益
  readonly weeklyStartEquity: Decimal;

  // 峰值权益（用于计算回撤）
  readonly peakEquity: Decimal;

  // 当前回撤
  readonly currentDrawdown: Decimal;

  // 当日盈亏
  readonly dailyPnl: Decimal;

  // 本周盈亏
  readonly weeklyPnl: Decimal;

  // 连续亏损次数
  readonly consecutiveLosses: number;

  // 是否触发熔断
  readonly circuitBreakerTriggered: boolean;

  // 熔断触发时间
  readonly circuitBreakerTime?: number;

  // 当前持仓
  readonly positions: Map<Symbol, Position>;

  // 订单计数
  readonly orderCounts: {
    readonly perMinute: number;
    readonly perHour: number;
  };
}

// ============================================================================
// 风控事件
// ============================================================================

/**
 * 风控事件类型
 */
export interface RiskEvents {
  // 风控检查失败
  riskCheckFailed: (result: RiskCheckResult, order: OrderRequest) => void;

  // 风险等级变化
  riskLevelChanged: (level: RiskLevel, reason: string) => void;

  // 触发熔断
  circuitBreakerTriggered: (reason: string) => void;

  // 熔断恢复
  circuitBreakerRecovered: () => void;

  // 仓位限制警告
  positionLimitWarning: (symbol: Symbol, currentPercent: Decimal, maxPercent: Decimal) => void;

  // 亏损限制警告
  lossLimitWarning: (type: 'daily' | 'weekly' | 'drawdown', current: Decimal, limit: Decimal) => void;
}

// ============================================================================
// 风控规则接口
// ============================================================================

/**
 * 风控规则接口
 * 所有风控规则都应实现此接口
 */
export interface IRiskRule {
  // 规则名称
  readonly name: string;

  // 规则描述
  readonly description: string;

  // 规则优先级（数字越小优先级越高）
  readonly priority: number;

  // 是否启用
  readonly enabled: boolean;

  // 检查订单
  check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult;
}
