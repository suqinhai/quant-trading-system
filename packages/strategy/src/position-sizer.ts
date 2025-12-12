// ============================================================================
// 仓位计算器
// 动态计算最优仓位大小，实现风险控制
// 核心功能：Kelly 公式、波动率调整、风险限制
// ============================================================================

import {
  type ExchangeId,
  type ArbitrageOpportunity,
  type PositionSizeParams,
  type PositionSizeResult,
  type RiskLimits,
  DEFAULT_RISK_LIMITS,
} from './types.js';

// ============================================================================
// 配置接口
// ============================================================================

// 仓位计算配置
interface PositionSizerConfig {
  // 风险限制
  riskLimits: RiskLimits;
  // 是否启用动态仓位
  enableDynamicSizing: boolean;
  // Kelly 系数缩放因子（0-1，越小越保守）
  kellyFraction: number;
  // 基础波动率（用于标准化）
  baseVolatility: number;
  // 最小仓位（USDT）
  minPositionSize: number;
  // 最大单笔仓位（USDT）
  maxPositionSize: number;
  // 默认杠杆
  defaultLeverage: number;
}

// 默认仓位计算配置
const DEFAULT_POSITION_SIZER_CONFIG: PositionSizerConfig = {
  // 使用默认风险限制
  riskLimits: DEFAULT_RISK_LIMITS,
  // 启用动态仓位
  enableDynamicSizing: true,
  // Kelly 系数使用 25%（四分之一 Kelly）
  kellyFraction: 0.25,
  // 基础波动率 2%
  baseVolatility: 0.02,
  // 最小仓位 100 USDT
  minPositionSize: 100,
  // 最大单笔仓位 50000 USDT
  maxPositionSize: 50000,
  // 默认杠杆 3 倍
  defaultLeverage: 3,
};

// ============================================================================
// 仓位计算器类
// ============================================================================

/**
 * 仓位计算器
 * 使用 Kelly 公式和风险控制计算最优仓位
 */
export class PositionSizer {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: PositionSizerConfig;

  // 各交易所当前持仓（exchange -> notional）
  private exchangePositions: Map<ExchangeId, number> = new Map();

  // 各套利对当前持仓（pair -> notional）
  private pairPositions: Map<string, number> = new Map();

  // 总持仓
  private totalPosition: number = 0;

  // 日交易次数
  private dailyTradeCount: number = 0;

  // 上次重置日期
  private lastResetDate: string = '';

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 仓位计算配置（可选）
   */
  constructor(config?: Partial<PositionSizerConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_POSITION_SIZER_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 仓位计算
  // ========================================================================

  /**
   * 计算建议仓位大小
   * @param params - 仓位计算参数
   */
  calculatePositionSize(params: PositionSizeParams): PositionSizeResult {
    // 解构参数
    const { equity, availableBalance, opportunity, volatility, riskFactor } = params;

    // 检查每日交易次数
    this.checkDailyReset();
    if (this.dailyTradeCount >= this.config.riskLimits.maxDailyTrades) {
      return this.createResult(0, 0, equity, '已达到每日最大交易次数');
    }

    // 计算基础仓位（使用 Kelly 公式）
    const kellyPosition = this.calculateKellyPosition(equity, opportunity);

    // 应用波动率调整
    const volatilityAdjusted = this.applyVolatilityAdjustment(
      kellyPosition,
      volatility
    );

    // 应用风险因子调整
    const riskAdjusted = volatilityAdjusted * (1 - riskFactor);

    // 应用各种限制
    const { limited, reason } = this.applyLimits(
      riskAdjusted,
      equity,
      availableBalance,
      opportunity
    );

    // 计算杠杆和保证金
    const leverage = Math.min(
      this.config.defaultLeverage,
      this.config.riskLimits.maxLeverage
    );
    const requiredMargin = limited / leverage;

    // 检查保证金是否足够
    if (requiredMargin > availableBalance) {
      // 调整仓位以适应可用余额
      const adjustedNotional = availableBalance * leverage;
      return this.createResult(
        adjustedNotional,
        leverage,
        equity,
        '保证金不足，已调整仓位'
      );
    }

    return this.createResult(limited, leverage, equity, reason);
  }

  /**
   * 计算平仓仓位
   * @param currentPosition - 当前持仓
   * @param closeRatio - 平仓比例（0-1）
   */
  calculateCloseSize(currentPosition: number, closeRatio: number = 1): number {
    // 限制平仓比例
    const ratio = Math.max(0, Math.min(1, closeRatio));

    // 计算平仓数量
    return currentPosition * ratio;
  }

  /**
   * 计算加仓仓位
   * @param params - 仓位计算参数
   * @param currentPosition - 当前持仓
   */
  calculateAddSize(
    params: PositionSizeParams,
    currentPosition: number
  ): PositionSizeResult {
    // 计算建议仓位
    const result = this.calculatePositionSize(params);

    // 如果建议仓位小于当前仓位，不加仓
    if (result.suggestedNotional <= currentPosition) {
      return this.createResult(0, result.leverage, params.equity, '当前仓位已足够');
    }

    // 计算加仓量
    const addSize = result.suggestedNotional - currentPosition;

    return {
      ...result,
      suggestedNotional: addSize,
      adjustmentReason: `加仓至建议仓位`,
    };
  }

  /**
   * 计算减仓仓位
   * @param params - 仓位计算参数
   * @param currentPosition - 当前持仓
   */
  calculateReduceSize(
    params: PositionSizeParams,
    currentPosition: number
  ): PositionSizeResult {
    // 计算建议仓位
    const result = this.calculatePositionSize(params);

    // 如果建议仓位大于当前仓位，不减仓
    if (result.suggestedNotional >= currentPosition) {
      return this.createResult(0, result.leverage, params.equity, '仓位无需减少');
    }

    // 计算减仓量
    const reduceSize = currentPosition - result.suggestedNotional;

    return {
      ...result,
      suggestedNotional: reduceSize,
      adjustmentReason: `减仓至建议仓位`,
    };
  }

  // ========================================================================
  // 公共方法 - 风险检查
  // ========================================================================

  /**
   * 检查是否可以开新仓位
   * @param equity - 权益
   * @param opportunity - 套利机会
   */
  canOpenPosition(equity: number, opportunity: ArbitrageOpportunity): {
    allowed: boolean;
    reason?: string;
  } {
    // 检查每日交易次数
    this.checkDailyReset();
    if (this.dailyTradeCount >= this.config.riskLimits.maxDailyTrades) {
      return { allowed: false, reason: '已达到每日最大交易次数' };
    }

    // 检查最小利差
    if (opportunity.spreadAnnualized < this.config.riskLimits.minSpreadAnnualized) {
      return {
        allowed: false,
        reason: `年化利差 ${(opportunity.spreadAnnualized * 100).toFixed(2)}% 低于最小要求 ${(this.config.riskLimits.minSpreadAnnualized * 100).toFixed(2)}%`,
      };
    }

    // 检查单个套利对持仓
    const pairKey = `${opportunity.symbol}_${opportunity.longExchange}_${opportunity.shortExchange}`;
    const pairPosition = this.pairPositions.get(pairKey) ?? 0;
    const maxPairPosition = equity * this.config.riskLimits.maxPositionPerPair;
    if (pairPosition >= maxPairPosition) {
      return { allowed: false, reason: '该套利对已达最大持仓' };
    }

    // 检查单个交易所持仓
    const longPosition = this.exchangePositions.get(opportunity.longExchange) ?? 0;
    const shortPosition = this.exchangePositions.get(opportunity.shortExchange) ?? 0;
    const maxExchangePosition = equity * this.config.riskLimits.maxPositionPerExchange;
    if (longPosition >= maxExchangePosition || shortPosition >= maxExchangePosition) {
      return { allowed: false, reason: '交易所已达最大持仓' };
    }

    // 检查总持仓
    const maxTotalPosition = equity * this.config.riskLimits.maxTotalPosition;
    if (this.totalPosition >= maxTotalPosition) {
      return { allowed: false, reason: '总持仓已达最大限制' };
    }

    return { allowed: true };
  }

  /**
   * 检查风险限制是否满足
   * @param equity - 权益
   * @param drawdown - 当前回撤
   */
  checkRiskLimits(equity: number, drawdown: number): {
    withinLimits: boolean;
    violations: string[];
  } {
    // 违规列表
    const violations: string[] = [];

    // 检查最大回撤
    if (drawdown >= this.config.riskLimits.maxDrawdown) {
      violations.push(
        `回撤 ${(drawdown * 100).toFixed(2)}% 超过限制 ${(this.config.riskLimits.maxDrawdown * 100).toFixed(2)}%`
      );
    }

    // 检查总持仓比例
    const positionRatio = this.totalPosition / equity;
    if (positionRatio > this.config.riskLimits.maxTotalPosition) {
      violations.push(
        `总持仓比例 ${(positionRatio * 100).toFixed(2)}% 超过限制 ${(this.config.riskLimits.maxTotalPosition * 100).toFixed(2)}%`
      );
    }

    return {
      withinLimits: violations.length === 0,
      violations,
    };
  }

  // ========================================================================
  // 公共方法 - 持仓更新
  // ========================================================================

  /**
   * 更新交易所持仓
   * @param exchange - 交易所
   * @param notional - 持仓价值
   */
  updateExchangePosition(exchange: ExchangeId, notional: number): void {
    const current = this.exchangePositions.get(exchange) ?? 0;
    this.exchangePositions.set(exchange, notional);

    // 更新总持仓
    this.totalPosition = this.totalPosition - current + notional;
  }

  /**
   * 更新套利对持仓
   * @param pairKey - 套利对键（symbol_long_short）
   * @param notional - 持仓价值
   */
  updatePairPosition(pairKey: string, notional: number): void {
    this.pairPositions.set(pairKey, notional);
  }

  /**
   * 记录交易
   */
  recordTrade(): void {
    this.checkDailyReset();
    this.dailyTradeCount++;
  }

  /**
   * 获取剩余交易次数
   */
  getRemainingTrades(): number {
    this.checkDailyReset();
    return Math.max(0, this.config.riskLimits.maxDailyTrades - this.dailyTradeCount);
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取交易所持仓
   * @param exchange - 交易所
   */
  getExchangePosition(exchange: ExchangeId): number {
    return this.exchangePositions.get(exchange) ?? 0;
  }

  /**
   * 获取套利对持仓
   * @param pairKey - 套利对键
   */
  getPairPosition(pairKey: string): number {
    return this.pairPositions.get(pairKey) ?? 0;
  }

  /**
   * 获取总持仓
   */
  getTotalPosition(): number {
    return this.totalPosition;
  }

  /**
   * 获取风险限制
   */
  getRiskLimits(): RiskLimits {
    return { ...this.config.riskLimits };
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有数据
   */
  clear(): void {
    this.exchangePositions.clear();
    this.pairPositions.clear();
    this.totalPosition = 0;
    this.dailyTradeCount = 0;
  }

  // ========================================================================
  // 私有方法 - Kelly 公式
  // ========================================================================

  /**
   * 使用 Kelly 公式计算最优仓位
   * @param equity - 权益
   * @param opportunity - 套利机会
   */
  private calculateKellyPosition(
    equity: number,
    opportunity: ArbitrageOpportunity
  ): number {
    // 如果未启用动态仓位，使用固定比例
    if (!this.config.enableDynamicSizing) {
      return equity * this.config.riskLimits.maxPositionPerPair;
    }

    // Kelly 公式：f* = (p * b - q) / b
    // 其中：
    //   p = 胜率
    //   q = 1 - p = 败率
    //   b = 赔率（盈利/亏损比）

    // 对于资金费率套利：
    //   - 胜率通常较高（假设基于历史数据的预测准确率）
    //   - 赔率基于预期收益和风险

    // 估算胜率（基于风险评分）
    // 风险评分 0-100，越低越好
    const winProbability = Math.max(0.5, 1 - opportunity.riskScore / 100);

    // 估算赔率（预期收益 / 最大亏损）
    // 假设最大亏损为滑点 + 手续费（约 0.2%）
    const maxLoss = 0.002;
    const expectedWin = Math.abs(opportunity.expectedReturn);
    const odds = expectedWin / maxLoss;

    // Kelly 公式
    const kellyFraction = (winProbability * odds - (1 - winProbability)) / odds;

    // 限制 Kelly 系数为正
    const boundedKelly = Math.max(0, kellyFraction);

    // 应用缩放因子（通常使用半 Kelly 或四分之一 Kelly）
    const scaledKelly = boundedKelly * this.config.kellyFraction;

    // 计算仓位
    return equity * scaledKelly;
  }

  /**
   * 应用波动率调整
   * @param position - 原始仓位
   * @param volatility - 当前波动率
   */
  private applyVolatilityAdjustment(
    position: number,
    volatility: number
  ): number {
    // 如果波动率为 0 或无效，不调整
    if (volatility <= 0) {
      return position;
    }

    // 波动率调整因子 = 基础波动率 / 当前波动率
    // 波动率高时减小仓位，波动率低时增大仓位
    const adjustmentFactor = this.config.baseVolatility / volatility;

    // 限制调整因子范围（0.5 - 2.0）
    const boundedFactor = Math.max(0.5, Math.min(2.0, adjustmentFactor));

    return position * boundedFactor;
  }

  /**
   * 应用各种限制
   * @param position - 计算后仓位
   * @param equity - 权益
   * @param availableBalance - 可用余额
   * @param opportunity - 套利机会
   */
  private applyLimits(
    position: number,
    equity: number,
    availableBalance: number,
    opportunity: ArbitrageOpportunity
  ): { limited: number; reason?: string } {
    let limited = position;
    let reason: string | undefined;

    // 1. 应用最小/最大仓位限制
    if (limited < this.config.minPositionSize) {
      limited = this.config.minPositionSize;
      reason = '已调整至最小仓位';
    }
    if (limited > this.config.maxPositionSize) {
      limited = this.config.maxPositionSize;
      reason = '已调整至最大仓位';
    }

    // 2. 应用单个套利对限制
    const pairKey = `${opportunity.symbol}_${opportunity.longExchange}_${opportunity.shortExchange}`;
    const currentPairPosition = this.pairPositions.get(pairKey) ?? 0;
    const maxPairPosition = equity * this.config.riskLimits.maxPositionPerPair;
    const availablePairCapacity = maxPairPosition - currentPairPosition;

    if (limited > availablePairCapacity) {
      limited = Math.max(0, availablePairCapacity);
      reason = '已调整至套利对最大仓位';
    }

    // 3. 应用单个交易所限制
    const longExchangePosition = this.exchangePositions.get(opportunity.longExchange) ?? 0;
    const shortExchangePosition = this.exchangePositions.get(opportunity.shortExchange) ?? 0;
    const maxExchangePosition = equity * this.config.riskLimits.maxPositionPerExchange;

    const longCapacity = maxExchangePosition - longExchangePosition;
    const shortCapacity = maxExchangePosition - shortExchangePosition;
    const minExchangeCapacity = Math.min(longCapacity, shortCapacity);

    if (limited > minExchangeCapacity) {
      limited = Math.max(0, minExchangeCapacity);
      reason = '已调整至交易所最大仓位';
    }

    // 4. 应用总持仓限制
    const maxTotalPosition = equity * this.config.riskLimits.maxTotalPosition;
    const availableTotalCapacity = maxTotalPosition - this.totalPosition;

    if (limited > availableTotalCapacity) {
      limited = Math.max(0, availableTotalCapacity);
      reason = '已调整至总仓位限制';
    }

    // 5. 应用杠杆限制
    const leverage = Math.min(
      this.config.defaultLeverage,
      this.config.riskLimits.maxLeverage
    );
    const maxNotionalByMargin = availableBalance * leverage;

    if (limited > maxNotionalByMargin) {
      limited = maxNotionalByMargin;
      reason = '已调整至保证金限制';
    }

    // 6. 使用建议仓位比例
    const suggestedPosition = limited * opportunity.suggestedSize;
    if (suggestedPosition < limited) {
      limited = suggestedPosition;
      reason = '已按建议比例调整';
    }

    return { limited, reason };
  }

  /**
   * 创建结果对象
   * @param notional - 仓位价值
   * @param leverage - 杠杆
   * @param equity - 权益
   * @param reason - 调整原因
   */
  private createResult(
    notional: number,
    leverage: number,
    equity: number,
    reason?: string
  ): PositionSizeResult {
    // 确保杠杆有效
    const validLeverage = leverage > 0 ? leverage : this.config.defaultLeverage;

    // 计算所需保证金
    const requiredMargin = notional / validLeverage;

    // 计算建议数量（假设价格为 1，实际使用时需要除以价格）
    const suggestedQuantity = notional;

    return {
      suggestedNotional: notional,
      suggestedQuantity,
      maxNotional: equity * this.config.riskLimits.maxPositionPerPair,
      minNotional: this.config.minPositionSize,
      leverage: validLeverage,
      requiredMargin,
      adjustmentReason: reason,
    };
  }

  /**
   * 检查并重置每日计数
   */
  private checkDailyReset(): void {
    // 获取当前日期
    const today = new Date().toISOString().split('T')[0]!;

    // 如果日期变化，重置计数
    if (today !== this.lastResetDate) {
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
    }
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建仓位计算器
 * @param config - 配置（可选）
 */
export function createPositionSizer(
  config?: Partial<PositionSizerConfig>
): PositionSizer {
  return new PositionSizer(config);
}

// 导出默认配置
export { DEFAULT_POSITION_SIZER_CONFIG };
export type { PositionSizerConfig };
