// ============================================================================
// 内置风控规则
// 提供常用的风控规则实现
// ============================================================================

import Decimal from 'decimal.js';

import type { OrderRequest } from '@quant/exchange';

import {
  RiskLevel,
  type IRiskRule,
  type RiskCheckResult,
  type RiskConfig,
  type RiskState,
} from './types';

// ============================================================================
// 仓位大小规则
// ============================================================================

/**
 * 单笔仓位大小限制规则
 */
export class PositionSizeRule implements IRiskRule {
  public readonly name = 'PositionSize';
  public readonly description = 'Limits the size of a single position';
  public readonly priority = 1;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 计算订单金额
    const price = order.price ?? new Decimal(0);
    const orderValue = order.amount.times(price);

    // 计算占权益的比例
    const positionPercent = orderValue.dividedBy(state.equity).times(100);

    // 检查是否超过限制
    if (positionPercent.greaterThan(config.positionLimits.maxPositionSizePercent)) {
      // 计算建议的数量
      const maxValue = state.equity.times(config.positionLimits.maxPositionSizePercent).dividedBy(100);
      const suggestedAmount = price.isZero() ? order.amount : maxValue.dividedBy(price);

      return {
        passed: false,
        reason: `Position size ${positionPercent.toFixed(2)}% exceeds limit ${config.positionLimits.maxPositionSizePercent.toFixed(2)}%`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
        suggestion: {
          amount: suggestedAmount,
        },
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 持仓数量规则
// ============================================================================

/**
 * 最大持仓数量限制规则
 */
export class MaxPositionsRule implements IRiskRule {
  public readonly name = 'MaxPositions';
  public readonly description = 'Limits the number of open positions';
  public readonly priority = 2;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 检查是否是新开仓（不是加仓或平仓）
    const existingPosition = state.positions.get(order.symbol);
    const isNewPosition = !existingPosition;

    if (isNewPosition) {
      // 检查当前持仓数量
      const currentPositions = state.positions.size;

      if (currentPositions >= config.positionLimits.maxOpenPositions) {
        return {
          passed: false,
          reason: `Already have ${currentPositions} open positions, max is ${config.positionLimits.maxOpenPositions}`,
          ruleName: this.name,
          riskLevel: RiskLevel.MEDIUM,
        };
      }
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 订单频率规则
// ============================================================================

/**
 * 订单频率限制规则
 */
export class OrderFrequencyRule implements IRiskRule {
  public readonly name = 'OrderFrequency';
  public readonly description = 'Limits the frequency of orders';
  public readonly priority = 3;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 检查每分钟订单数
    if (state.orderCounts.perMinute >= config.orderLimits.maxOrdersPerMinute) {
      return {
        passed: false,
        reason: `Order frequency limit reached: ${state.orderCounts.perMinute} orders per minute`,
        ruleName: this.name,
        riskLevel: RiskLevel.MEDIUM,
      };
    }

    // 检查每小时订单数
    if (state.orderCounts.perHour >= config.orderLimits.maxOrdersPerHour) {
      return {
        passed: false,
        reason: `Order frequency limit reached: ${state.orderCounts.perHour} orders per hour`,
        ruleName: this.name,
        riskLevel: RiskLevel.MEDIUM,
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 订单金额规则
// ============================================================================

/**
 * 订单金额限制规则
 */
export class OrderValueRule implements IRiskRule {
  public readonly name = 'OrderValue';
  public readonly description = 'Limits the value of a single order';
  public readonly priority = 4;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    const price = order.price ?? new Decimal(0);
    const orderValue = order.amount.times(price);

    // 检查最大金额
    if (orderValue.greaterThan(config.orderLimits.maxOrderValue)) {
      const suggestedAmount = price.isZero()
        ? order.amount
        : config.orderLimits.maxOrderValue.dividedBy(price);

      return {
        passed: false,
        reason: `Order value ${orderValue.toFixed(2)} exceeds max ${config.orderLimits.maxOrderValue.toFixed(2)}`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
        suggestion: {
          amount: suggestedAmount,
        },
      };
    }

    // 检查最小金额
    if (orderValue.lessThan(config.orderLimits.minOrderValue)) {
      return {
        passed: false,
        reason: `Order value ${orderValue.toFixed(2)} below min ${config.orderLimits.minOrderValue.toFixed(2)}`,
        ruleName: this.name,
        riskLevel: RiskLevel.LOW,
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 每日亏损规则
// ============================================================================

/**
 * 每日亏损限制规则
 */
export class DailyLossRule implements IRiskRule {
  public readonly name = 'DailyLoss';
  public readonly description = 'Limits daily losses';
  public readonly priority = 5;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 计算当日亏损百分比
    const dailyLossPercent = state.dailyPnl.isNegative()
      ? state.dailyPnl.abs().dividedBy(state.dailyStartEquity).times(100)
      : new Decimal(0);

    // 检查是否超过限制
    if (dailyLossPercent.greaterThanOrEqualTo(config.lossLimits.maxDailyLoss)) {
      return {
        passed: false,
        reason: `Daily loss ${dailyLossPercent.toFixed(2)}% reached limit ${config.lossLimits.maxDailyLoss.toFixed(2)}%`,
        ruleName: this.name,
        riskLevel: RiskLevel.CRITICAL,
      };
    }

    // 警告级别（达到 80%）
    const warningThreshold = config.lossLimits.maxDailyLoss.times(0.8);
    if (dailyLossPercent.greaterThanOrEqualTo(warningThreshold)) {
      return {
        passed: true,
        reason: `Daily loss ${dailyLossPercent.toFixed(2)}% approaching limit`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 最大回撤规则
// ============================================================================

/**
 * 最大回撤限制规则
 */
export class MaxDrawdownRule implements IRiskRule {
  public readonly name = 'MaxDrawdown';
  public readonly description = 'Limits maximum drawdown';
  public readonly priority = 6;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 检查当前回撤
    if (state.currentDrawdown.greaterThanOrEqualTo(config.lossLimits.maxDrawdown)) {
      return {
        passed: false,
        reason: `Current drawdown ${state.currentDrawdown.toFixed(2)}% reached limit ${config.lossLimits.maxDrawdown.toFixed(2)}%`,
        ruleName: this.name,
        riskLevel: RiskLevel.CRITICAL,
      };
    }

    // 警告级别
    const warningThreshold = config.lossLimits.maxDrawdown.times(0.8);
    if (state.currentDrawdown.greaterThanOrEqualTo(warningThreshold)) {
      return {
        passed: true,
        reason: `Drawdown ${state.currentDrawdown.toFixed(2)}% approaching limit`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 连续亏损规则
// ============================================================================

/**
 * 连续亏损限制规则
 */
export class ConsecutiveLossesRule implements IRiskRule {
  public readonly name = 'ConsecutiveLosses';
  public readonly description = 'Limits consecutive losing trades';
  public readonly priority = 7;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    if (state.consecutiveLosses >= config.lossLimits.maxConsecutiveLosses) {
      return {
        passed: false,
        reason: `${state.consecutiveLosses} consecutive losses reached limit ${config.lossLimits.maxConsecutiveLosses}`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
      };
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 熔断规则
// ============================================================================

/**
 * 熔断检查规则
 */
export class CircuitBreakerRule implements IRiskRule {
  public readonly name = 'CircuitBreaker';
  public readonly description = 'Checks if circuit breaker is active';
  public readonly priority = 0; // 最高优先级
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    if (!config.enableCircuitBreaker) {
      return {
        passed: true,
        ruleName: this.name,
        riskLevel: RiskLevel.LOW,
      };
    }

    if (state.circuitBreakerTriggered) {
      // 检查冷却时间
      const now = Date.now();
      const timeSinceTriggered = now - (state.circuitBreakerTime ?? 0);

      if (timeSinceTriggered < config.circuitBreakerCooldown) {
        const remainingTime = Math.ceil(
          (config.circuitBreakerCooldown - timeSinceTriggered) / 1000 / 60
        );
        return {
          passed: false,
          reason: `Circuit breaker active. ${remainingTime} minutes remaining`,
          ruleName: this.name,
          riskLevel: RiskLevel.CRITICAL,
        };
      }
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 交易对白名单/黑名单规则
// ============================================================================

/**
 * 交易对过滤规则
 */
export class SymbolFilterRule implements IRiskRule {
  public readonly name = 'SymbolFilter';
  public readonly description = 'Filters symbols by whitelist/blacklist';
  public readonly priority = 1;
  public readonly enabled = true;

  public check(order: OrderRequest, state: RiskState, config: RiskConfig): RiskCheckResult {
    // 检查黑名单
    if (config.symbolBlacklist?.includes(order.symbol)) {
      return {
        passed: false,
        reason: `Symbol ${order.symbol} is blacklisted`,
        ruleName: this.name,
        riskLevel: RiskLevel.HIGH,
      };
    }

    // 检查白名单（如果配置了白名单，则只允许白名单中的交易对）
    if (config.symbolWhitelist && config.symbolWhitelist.length > 0) {
      if (!config.symbolWhitelist.includes(order.symbol)) {
        return {
          passed: false,
          reason: `Symbol ${order.symbol} not in whitelist`,
          ruleName: this.name,
          riskLevel: RiskLevel.MEDIUM,
        };
      }
    }

    return {
      passed: true,
      ruleName: this.name,
      riskLevel: RiskLevel.LOW,
    };
  }
}

// ============================================================================
// 导出所有规则
// ============================================================================

/**
 * 获取所有内置规则
 */
export function getBuiltInRules(): IRiskRule[] {
  return [
    new CircuitBreakerRule(),
    new SymbolFilterRule(),
    new PositionSizeRule(),
    new MaxPositionsRule(),
    new OrderFrequencyRule(),
    new OrderValueRule(),
    new DailyLossRule(),
    new MaxDrawdownRule(),
    new ConsecutiveLossesRule(),
  ];
}
