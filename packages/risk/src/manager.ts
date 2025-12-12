// ============================================================================
// 风控管理器
// 统一管理所有风控规则和状态
// ============================================================================

import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';
import pino from 'pino';

import type { OrderRequest, Position, Symbol } from '@quant/exchange';

import { getBuiltInRules } from './rules.js';
import {
  RiskLevel,
  type IRiskRule,
  type RiskCheckResult,
  type RiskConfig,
  type RiskEvents,
  type RiskState,
} from './types.js';

// ============================================================================
// 风控管理器
// ============================================================================

/**
 * 风控管理器
 *
 * 功能：
 * - 管理所有风控规则
 * - 维护风控状态
 * - 检查订单是否符合风控要求
 * - 触发熔断和恢复
 */
export class RiskManager extends EventEmitter<RiskEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 风控配置
  private config: RiskConfig;

  // 风控规则列表
  private rules: IRiskRule[] = [];

  // 风控状态
  private state: RiskState;

  // 订单时间戳记录（用于频率限制）
  private orderTimestamps: number[] = [];

  /**
   * 构造函数
   * @param config - 风控配置
   */
  public constructor(config: RiskConfig) {
    super();

    this.config = config;

    // 初始化日志
    this.logger = pino({
      name: 'RiskManager',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化状态
    this.state = this.createInitialState();

    // 加载内置规则
    this.rules = getBuiltInRules();

    this.logger.info('RiskManager initialized');
  }

  /**
   * 创建初始状态
   */
  private createInitialState(): RiskState {
    const initialEquity = new Decimal(0);

    return {
      equity: initialEquity,
      dailyStartEquity: initialEquity,
      weeklyStartEquity: initialEquity,
      peakEquity: initialEquity,
      currentDrawdown: new Decimal(0),
      dailyPnl: new Decimal(0),
      weeklyPnl: new Decimal(0),
      consecutiveLosses: 0,
      circuitBreakerTriggered: false,
      positions: new Map(),
      orderCounts: {
        perMinute: 0,
        perHour: 0,
      },
    };
  }

  // ==========================================================================
  // 规则管理
  // ==========================================================================

  /**
   * 添加自定义规则
   */
  public addRule(rule: IRiskRule): void {
    this.rules.push(rule);
    // 按优先级排序
    this.rules.sort((a, b) => a.priority - b.priority);
    this.logger.info({ ruleName: rule.name }, 'Rule added');
  }

  /**
   * 移除规则
   */
  public removeRule(ruleName: string): boolean {
    const index = this.rules.findIndex(r => r.name === ruleName);
    if (index !== -1) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 启用/禁用规则
   */
  public setRuleEnabled(ruleName: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.name === ruleName);
    if (rule) {
      // 使用类型断言修改 enabled 属性
      (rule as { enabled: boolean }).enabled = enabled;
      return true;
    }
    return false;
  }

  // ==========================================================================
  // 订单检查
  // ==========================================================================

  /**
   * 检查订单是否符合风控要求
   * @param order - 订单请求
   * @returns 所有规则的检查结果
   */
  public checkOrder(order: OrderRequest): RiskCheckResult[] {
    const results: RiskCheckResult[] = [];

    // 更新订单计数
    this.updateOrderCounts();

    // 按优先级执行所有规则
    for (const rule of this.rules) {
      if (!rule.enabled) {
        continue;
      }

      const result = rule.check(order, this.state, this.config);
      results.push(result);

      // 如果有规则未通过，记录并发出事件
      if (!result.passed) {
        this.logger.warn(
          {
            ruleName: result.ruleName,
            reason: result.reason,
            symbol: order.symbol,
          },
          'Risk check failed'
        );

        this.emit('riskCheckFailed', result, order);

        // 如果是严重风险，可能需要触发熔断
        if (result.riskLevel === RiskLevel.CRITICAL) {
          this.triggerCircuitBreaker(result.reason ?? 'Critical risk level reached');
        }
      }
    }

    return results;
  }

  /**
   * 检查订单是否可以执行
   * @param order - 订单请求
   * @returns 是否可以执行
   */
  public canExecuteOrder(order: OrderRequest): boolean {
    const results = this.checkOrder(order);
    return results.every(r => r.passed);
  }

  /**
   * 获取最高风险等级
   */
  public getHighestRiskLevel(results: RiskCheckResult[]): RiskLevel {
    const levels = [RiskLevel.LOW, RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL];
    let highest = RiskLevel.LOW;

    for (const result of results) {
      const currentIndex = levels.indexOf(result.riskLevel);
      const highestIndex = levels.indexOf(highest);

      if (currentIndex > highestIndex) {
        highest = result.riskLevel;
      }
    }

    return highest;
  }

  // ==========================================================================
  // 状态更新
  // ==========================================================================

  /**
   * 更新权益
   */
  public updateEquity(equity: Decimal): void {
    const prevEquity = this.state.equity;

    // 更新峰值
    if (equity.greaterThan(this.state.peakEquity)) {
      this.state = {
        ...this.state,
        peakEquity: equity,
      };
    }

    // 计算回撤
    const drawdown = this.state.peakEquity.isZero()
      ? new Decimal(0)
      : this.state.peakEquity.minus(equity).dividedBy(this.state.peakEquity).times(100);

    // 更新每日盈亏
    const dailyPnl = equity.minus(this.state.dailyStartEquity);

    // 更新每周盈亏
    const weeklyPnl = equity.minus(this.state.weeklyStartEquity);

    this.state = {
      ...this.state,
      equity,
      currentDrawdown: drawdown,
      dailyPnl,
      weeklyPnl,
    };

    // 检查亏损限制警告
    this.checkLossWarnings();
  }

  /**
   * 更新仓位
   */
  public updatePositions(positions: Map<Symbol, Position>): void {
    this.state = {
      ...this.state,
      positions: new Map(positions),
    };
  }

  /**
   * 记录交易结果
   */
  public recordTradeResult(pnl: Decimal): void {
    if (pnl.isNegative()) {
      // 亏损交易
      this.state = {
        ...this.state,
        consecutiveLosses: this.state.consecutiveLosses + 1,
      };

      // 检查连续亏损
      if (this.state.consecutiveLosses >= this.config.lossLimits.maxConsecutiveLosses) {
        this.triggerCircuitBreaker(
          `${this.state.consecutiveLosses} consecutive losses`
        );
      }
    } else if (pnl.isPositive()) {
      // 盈利交易，重置连续亏损计数
      this.state = {
        ...this.state,
        consecutiveLosses: 0,
      };
    }
  }

  /**
   * 重置每日统计
   */
  public resetDailyStats(): void {
    this.state = {
      ...this.state,
      dailyStartEquity: this.state.equity,
      dailyPnl: new Decimal(0),
    };

    this.logger.info('Daily stats reset');
  }

  /**
   * 重置每周统计
   */
  public resetWeeklyStats(): void {
    this.state = {
      ...this.state,
      weeklyStartEquity: this.state.equity,
      weeklyPnl: new Decimal(0),
    };

    this.logger.info('Weekly stats reset');
  }

  /**
   * 初始化状态
   */
  public initializeState(equity: Decimal): void {
    this.state = {
      equity,
      dailyStartEquity: equity,
      weeklyStartEquity: equity,
      peakEquity: equity,
      currentDrawdown: new Decimal(0),
      dailyPnl: new Decimal(0),
      weeklyPnl: new Decimal(0),
      consecutiveLosses: 0,
      circuitBreakerTriggered: false,
      positions: new Map(),
      orderCounts: {
        perMinute: 0,
        perHour: 0,
      },
    };

    this.logger.info({ equity: equity.toFixed(2) }, 'State initialized');
  }

  // ==========================================================================
  // 熔断管理
  // ==========================================================================

  /**
   * 触发熔断
   */
  public triggerCircuitBreaker(reason: string): void {
    if (this.state.circuitBreakerTriggered) {
      return;
    }

    this.state = {
      ...this.state,
      circuitBreakerTriggered: true,
      circuitBreakerTime: Date.now(),
    };

    this.logger.error({ reason }, 'Circuit breaker triggered');
    this.emit('circuitBreakerTriggered', reason);
  }

  /**
   * 重置熔断
   */
  public resetCircuitBreaker(): void {
    this.state = {
      ...this.state,
      circuitBreakerTriggered: false,
      circuitBreakerTime: undefined,
    };

    this.logger.info('Circuit breaker reset');
    this.emit('circuitBreakerRecovered');
  }

  /**
   * 检查熔断是否已冷却
   */
  public isCircuitBreakerCooledDown(): boolean {
    if (!this.state.circuitBreakerTriggered) {
      return true;
    }

    const now = Date.now();
    const timeSinceTriggered = now - (this.state.circuitBreakerTime ?? 0);

    return timeSinceTriggered >= this.config.circuitBreakerCooldown;
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 更新订单计数
   */
  private updateOrderCounts(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // 添加当前时间戳
    this.orderTimestamps.push(now);

    // 清理旧的时间戳
    this.orderTimestamps = this.orderTimestamps.filter(ts => ts > oneHourAgo);

    // 计算计数
    const perMinute = this.orderTimestamps.filter(ts => ts > oneMinuteAgo).length;
    const perHour = this.orderTimestamps.length;

    this.state = {
      ...this.state,
      orderCounts: {
        perMinute,
        perHour,
      },
    };
  }

  /**
   * 检查亏损警告
   */
  private checkLossWarnings(): void {
    // 每日亏损警告
    if (this.state.dailyPnl.isNegative()) {
      const dailyLossPercent = this.state.dailyPnl
        .abs()
        .dividedBy(this.state.dailyStartEquity)
        .times(100);
      const warningThreshold = this.config.lossLimits.maxDailyLoss.times(0.8);

      if (dailyLossPercent.greaterThanOrEqualTo(warningThreshold)) {
        this.emit(
          'lossLimitWarning',
          'daily',
          dailyLossPercent,
          this.config.lossLimits.maxDailyLoss
        );
      }
    }

    // 回撤警告
    const drawdownWarningThreshold = this.config.lossLimits.maxDrawdown.times(0.8);
    if (this.state.currentDrawdown.greaterThanOrEqualTo(drawdownWarningThreshold)) {
      this.emit(
        'lossLimitWarning',
        'drawdown',
        this.state.currentDrawdown,
        this.config.lossLimits.maxDrawdown
      );
    }
  }

  // ==========================================================================
  // 状态访问器
  // ==========================================================================

  /**
   * 获取当前状态
   */
  public getState(): RiskState {
    return { ...this.state };
  }

  /**
   * 获取配置
   */
  public getConfig(): RiskConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  public updateConfig(config: Partial<RiskConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Config updated');
  }

  /**
   * 获取所有规则
   */
  public getRules(): IRiskRule[] {
    return [...this.rules];
  }
}
