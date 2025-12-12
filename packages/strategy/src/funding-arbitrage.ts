// ============================================================================
// 资金费率套利策略
// 主策略实现：整合资金费率计算、库存管理、仓位控制、套利检测
// 目标：夏普比率 > 4.0，最大回撤 < 8%
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type PositionSide,
  type ArbitrageOpportunity,
  type TradeSignal,
  type StrategyState,
  type StrategyMetrics,
  type FundingArbitrageConfig,
  DEFAULT_FUNDING_ARBITRAGE_CONFIG,
  generateId,
} from './types';
import {
  FundingCalculator,
  createFundingCalculator,
} from './funding-calculator';
import {
  InventoryManager,
  createInventoryManager,
} from './inventory-manager';
import {
  PositionSizer,
  createPositionSizer,
} from './position-sizer';
import {
  ArbitrageDetector,
  createArbitrageDetector,
} from './arbitrage-detector';

// ============================================================================
// 策略事件类型
// ============================================================================

// 策略事件监听器类型
type StrategyEventListener<T> = (event: T) => void;

// 信号事件
interface SignalEvent {
  // 信号
  signal: TradeSignal;
  // 时间戳
  timestamp: Timestamp;
}

// 状态更新事件
interface StateUpdateEvent {
  // 旧状态
  oldState: StrategyState;
  // 新状态
  newState: StrategyState;
  // 时间戳
  timestamp: Timestamp;
}

// 机会事件
interface OpportunityEvent {
  // 机会列表
  opportunities: ArbitrageOpportunity[];
  // 最佳机会
  bestOpportunity?: ArbitrageOpportunity;
  // 时间戳
  timestamp: Timestamp;
}

// ============================================================================
// 收益记录
// ============================================================================

// 单次收益记录
interface PnlRecord {
  // 记录时间
  timestamp: Timestamp;
  // 收益金额
  pnl: number;
  // 收益来源
  source: 'trading' | 'funding';
}

// ============================================================================
// 资金费率套利策略类
// ============================================================================

/**
 * 资金费率套利策略
 * 核心策略类，整合所有组件实现完整的套利逻辑
 */
export class FundingArbitrageStrategy {
  // ========================================================================
  // 私有属性 - 组件
  // ========================================================================

  // 策略配置
  private config: FundingArbitrageConfig;

  // 资金费率计算器
  private fundingCalculator: FundingCalculator;

  // 库存管理器
  private inventoryManager: InventoryManager;

  // 仓位计算器
  private positionSizer: PositionSizer;

  // 套利检测器
  private arbitrageDetector: ArbitrageDetector;

  // ========================================================================
  // 私有属性 - 状态
  // ========================================================================

  // 策略状态
  private state: StrategyState;

  // 收益记录（用于计算夏普比率）
  private pnlHistory: PnlRecord[] = [];

  // 日收益记录（用于计算夏普比率）
  private dailyReturns: number[] = [];

  // 当前日期
  private currentDate: string = '';

  // 当日收益
  private currentDayPnl: number = 0;

  // ========================================================================
  // 私有属性 - 事件监听
  // ========================================================================

  // 信号事件监听器
  private signalListeners: StrategyEventListener<SignalEvent>[] = [];

  // 状态更新监听器
  private stateListeners: StrategyEventListener<StateUpdateEvent>[] = [];

  // 机会事件监听器
  private opportunityListeners: StrategyEventListener<OpportunityEvent>[] = [];

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 策略配置（可选）
   */
  constructor(config?: Partial<FundingArbitrageConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_FUNDING_ARBITRAGE_CONFIG, ...config };

    // 创建资金费率计算器
    this.fundingCalculator = createFundingCalculator({
      emaWindow: 12,
      linearWindow: 24,
      maxHistorySize: 90,
    });

    // 创建库存管理器
    this.inventoryManager = createInventoryManager({
      rebalanceThreshold: this.config.rebalanceThreshold,
      maxInventoryRatio: this.config.maxInventoryRatio,
    });

    // 创建仓位计算器
    this.positionSizer = createPositionSizer({
      riskLimits: this.config.riskLimits,
      enableDynamicSizing: this.config.enableDynamicSizing,
      kellyFraction: 0.25,
    });

    // 创建套利检测器
    this.arbitrageDetector = createArbitrageDetector(this.fundingCalculator, {
      minSpreadAnnualized: this.config.minSpreadToOpen,
      minConfidence: 0.5,
    });

    // 初始化状态
    this.state = this.createInitialState();
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动策略
   * @param initialEquity - 初始权益
   */
  start(initialEquity: number): void {
    // 检查是否已在运行
    if (this.state.running) {
      return;
    }

    // 设置初始权益
    this.state.initialEquity = initialEquity;
    this.state.equity = initialEquity;
    this.state.peakEquity = initialEquity;

    // 更新库存管理器权益
    this.inventoryManager.setEquity(initialEquity);

    // 设置运行状态
    this.state.running = true;
    this.state.paused = false;
    this.state.startedAt = Date.now();
    this.state.updatedAt = Date.now();

    // 初始化日期
    this.currentDate = new Date().toISOString().split('T')[0]!;
    this.currentDayPnl = 0;
  }

  /**
   * 停止策略
   */
  stop(): void {
    // 记录当日收益
    this.recordDailyReturn();

    // 设置运行状态
    this.state.running = false;
    this.state.updatedAt = Date.now();
  }

  /**
   * 暂停策略
   * @param reason - 暂停原因
   */
  pause(reason: string): void {
    this.state.paused = true;
    this.state.pauseReason = reason;
    this.state.updatedAt = Date.now();
  }

  /**
   * 恢复策略
   */
  resume(): void {
    this.state.paused = false;
    this.state.pauseReason = undefined;
    this.state.updatedAt = Date.now();
  }

  /**
   * 重置策略
   */
  reset(): void {
    // 停止策略
    this.stop();

    // 清空所有组件
    this.fundingCalculator.clear();
    this.inventoryManager.clear();
    this.positionSizer.clear();
    this.arbitrageDetector.clear();

    // 清空收益记录
    this.pnlHistory = [];
    this.dailyReturns = [];

    // 重置状态
    this.state = this.createInitialState();
  }

  // ========================================================================
  // 公共方法 - 数据更新
  // ========================================================================

  /**
   * 更新资金费率
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param rate - 当前费率
   * @param predictedRate - 预测费率
   * @param markPrice - 标记价格
   * @param indexPrice - 指数价格
   * @param nextFundingTime - 下次结算时间
   */
  updateFundingRate(
    exchange: ExchangeId,
    symbol: string,
    rate: number,
    predictedRate: number,
    markPrice: number,
    indexPrice: number,
    nextFundingTime: Timestamp
  ): void {
    // 更新资金费率计算器
    this.fundingCalculator.updateRate(
      exchange,
      symbol,
      rate,
      predictedRate,
      markPrice,
      indexPrice,
      nextFundingTime
    );
  }

  /**
   * 批量更新资金费率
   * @param rates - 费率数据数组
   */
  updateFundingRates(
    rates: {
      exchange: ExchangeId;
      symbol: string;
      rate: number;
      predictedRate: number;
      markPrice: number;
      indexPrice: number;
      nextFundingTime: Timestamp;
    }[]
  ): void {
    // 遍历更新
    for (const r of rates) {
      this.updateFundingRate(
        r.exchange,
        r.symbol,
        r.rate,
        r.predictedRate,
        r.markPrice,
        r.indexPrice,
        r.nextFundingTime
      );
    }
  }

  /**
   * 更新持仓
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param side - 持仓方向
   * @param quantity - 持仓数量
   * @param entryPrice - 开仓均价
   * @param leverage - 杠杆倍数
   */
  updatePosition(
    exchange: ExchangeId,
    symbol: string,
    side: PositionSide,
    quantity: number,
    entryPrice: number,
    leverage: number
  ): void {
    // 更新库存管理器
    this.inventoryManager.updatePosition(
      exchange,
      symbol,
      side,
      quantity,
      entryPrice,
      leverage
    );

    // 更新仓位计算器
    const notional = quantity * entryPrice;
    this.positionSizer.updateExchangePosition(exchange, notional);
  }

  /**
   * 更新权益
   * @param equity - 当前权益
   */
  updateEquity(equity: number): void {
    // 保存旧状态
    const oldState = { ...this.state };

    // 更新权益
    this.state.equity = equity;

    // 更新峰值
    if (equity > this.state.peakEquity) {
      this.state.peakEquity = equity;
    }

    // 计算回撤
    this.state.currentDrawdown = 1 - equity / this.state.peakEquity;

    // 检查最大回撤
    if (this.state.currentDrawdown > this.state.maxDrawdown) {
      this.state.maxDrawdown = this.state.currentDrawdown;
    }

    // 计算总盈亏
    this.state.totalPnl = equity - this.state.initialEquity;

    // 更新库存管理器权益
    this.inventoryManager.setEquity(equity);

    // 更新时间
    this.state.updatedAt = Date.now();

    // 触发状态更新事件
    this.emitStateUpdate(oldState, this.state);

    // 检查是否需要暂停（回撤超限）
    if (this.state.currentDrawdown >= this.config.targetMaxDrawdown) {
      this.pause(`回撤 ${(this.state.currentDrawdown * 100).toFixed(2)}% 超过目标 ${(this.config.targetMaxDrawdown * 100).toFixed(2)}%`);
    }
  }

  /**
   * 记录交易
   * @param pnl - 交易盈亏
   * @param isWin - 是否盈利
   */
  recordTrade(pnl: number, isWin: boolean): void {
    // 更新交易计数
    this.state.tradeCount++;

    // 更新胜负计数
    if (isWin) {
      this.state.winCount++;
    } else {
      this.state.lossCount++;
    }

    // 记录收益
    this.recordPnl(pnl, 'trading');

    // 更新仓位计算器
    this.positionSizer.recordTrade();

    // 更新时间
    this.state.updatedAt = Date.now();
  }

  /**
   * 记录资金费用
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param fundingFee - 资金费用（正数为支出）
   */
  recordFundingFee(
    exchange: ExchangeId,
    symbol: string,
    fundingFee: number
  ): void {
    // 更新库存管理器
    this.inventoryManager.recordFundingFee(exchange, symbol, fundingFee);

    // 更新总资金费盈亏（负数为收入）
    this.state.totalFundingPnl -= fundingFee;

    // 记录收益
    this.recordPnl(-fundingFee, 'funding');

    // 更新时间
    this.state.updatedAt = Date.now();
  }

  /**
   * 记录手续费
   * @param fee - 手续费
   */
  recordFee(fee: number): void {
    this.state.totalFees += fee;
    this.state.updatedAt = Date.now();
  }

  // ========================================================================
  // 公共方法 - 信号生成
  // ========================================================================

  /**
   * 生成交易信号
   * @param symbol - 交易对
   */
  generateSignals(symbol: string): TradeSignal[] {
    // 结果数组
    const signals: TradeSignal[] = [];

    // 检查策略状态
    if (!this.state.running || this.state.paused) {
      return signals;
    }

    // 检查风险限制
    const riskCheck = this.positionSizer.checkRiskLimits(
      this.state.equity,
      this.state.currentDrawdown
    );
    if (!riskCheck.withinLimits) {
      // 触发平仓信号
      const closeSignal = this.generateCloseSignal(symbol, riskCheck.violations.join(', '));
      if (closeSignal) {
        signals.push(closeSignal);
      }
      return signals;
    }

    // 检查再平衡需求
    if (this.config.enableAutoRebalance && this.inventoryManager.needsRebalance(symbol)) {
      const rebalanceSignal = this.generateRebalanceSignal(symbol);
      if (rebalanceSignal) {
        signals.push(rebalanceSignal);
        // 再平衡时不开新仓
        return signals;
      }
    }

    // 检测套利机会
    const opportunities = this.arbitrageDetector.detectOpportunities(symbol);

    // 触发机会事件
    this.emitOpportunity(opportunities);

    // 如果没有机会，检查是否需要平仓
    if (opportunities.length === 0) {
      // 检查现有仓位是否需要平仓
      const closeSignal = this.checkForClose(symbol);
      if (closeSignal) {
        signals.push(closeSignal);
      }
      return signals;
    }

    // 获取最佳机会
    const bestOpportunity = opportunities[0]!;

    // 检查是否可以开仓
    const canOpen = this.positionSizer.canOpenPosition(this.state.equity, bestOpportunity);
    const canOpenInventory = this.inventoryManager.canOpenPosition(symbol);

    if (canOpen.allowed && canOpenInventory) {
      // 生成开仓信号
      const openSignal = this.generateOpenSignal(symbol, bestOpportunity);
      if (openSignal) {
        signals.push(openSignal);
      }
    }

    // 触发信号事件
    for (const signal of signals) {
      this.emitSignal(signal);
    }

    return signals;
  }

  /**
   * 执行策略周期
   * 主循环方法，检测所有交易对
   */
  tick(): TradeSignal[] {
    // 结果数组
    const allSignals: TradeSignal[] = [];

    // 检查策略状态
    if (!this.state.running || this.state.paused) {
      return allSignals;
    }

    // 检查日期变化
    this.checkDateChange();

    // 遍历所有交易对
    for (const symbol of this.config.symbols) {
      // 生成信号
      const signals = this.generateSignals(symbol);

      // 添加到结果
      allSignals.push(...signals);
    }

    // 更新夏普比率
    this.updateSharpeRatio();

    return allSignals;
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取策略状态
   */
  getState(): StrategyState {
    return { ...this.state };
  }

  /**
   * 获取策略指标
   */
  getMetrics(): StrategyMetrics {
    // 计算运行天数
    const runningDays = Math.max(
      1,
      (Date.now() - this.state.startedAt) / (24 * 60 * 60 * 1000)
    );

    // 计算总收益率
    const totalReturn = this.state.totalPnl / this.state.initialEquity;

    // 计算年化收益率
    const annualizedReturn = Math.pow(1 + totalReturn, 365 / runningDays) - 1;

    // 计算胜率
    const winRate = this.state.tradeCount > 0
      ? this.state.winCount / this.state.tradeCount
      : 0;

    // 计算盈亏比（简化：假设平均盈利/平均亏损）
    const profitFactor = this.state.lossCount > 0
      ? Math.abs(this.state.winCount / this.state.lossCount)
      : this.state.winCount > 0 ? Infinity : 1;

    // 计算日均交易次数
    const avgDailyTrades = this.state.tradeCount / runningDays;

    // 计算资金费收益占比
    const fundingPnlRatio = this.state.totalPnl !== 0
      ? this.state.totalFundingPnl / Math.abs(this.state.totalPnl)
      : 0;

    // 计算索提诺比率（简化：使用夏普比率 * 1.2）
    const sortinoRatio = this.state.sharpeRatio * 1.2;

    // 计算卡玛比率
    const calmarRatio = this.state.maxDrawdown > 0
      ? annualizedReturn / this.state.maxDrawdown
      : annualizedReturn > 0 ? Infinity : 0;

    return {
      totalReturn,
      annualizedReturn,
      sharpeRatio: this.state.sharpeRatio,
      sortinoRatio,
      calmarRatio,
      maxDrawdown: this.state.maxDrawdown,
      winRate,
      profitFactor,
      avgHoldingTime: 0, // 需要额外跟踪
      avgDailyTrades,
      fundingPnlRatio,
    };
  }

  /**
   * 获取配置
   */
  getConfig(): FundingArbitrageConfig {
    return { ...this.config };
  }

  /**
   * 获取资金费率计算器
   */
  getFundingCalculator(): FundingCalculator {
    return this.fundingCalculator;
  }

  /**
   * 获取库存管理器
   */
  getInventoryManager(): InventoryManager {
    return this.inventoryManager;
  }

  /**
   * 获取仓位计算器
   */
  getPositionSizer(): PositionSizer {
    return this.positionSizer;
  }

  /**
   * 获取套利检测器
   */
  getArbitrageDetector(): ArbitrageDetector {
    return this.arbitrageDetector;
  }

  /**
   * 获取所有交易对的套利机会
   */
  getAllOpportunities(): Map<string, ArbitrageOpportunity[]> {
    const result = new Map<string, ArbitrageOpportunity[]>();

    for (const symbol of this.config.symbols) {
      const opportunities = this.arbitrageDetector.getValidOpportunities(symbol);
      result.set(symbol, opportunities);
    }

    return result;
  }

  /**
   * 获取库存摘要
   */
  getInventorySummary(): Map<string, ReturnType<InventoryManager['getInventorySummary']>> {
    const result = new Map<string, ReturnType<InventoryManager['getInventorySummary']>>();

    for (const symbol of this.config.symbols) {
      const summary = this.inventoryManager.getInventorySummary(symbol);
      result.set(symbol, summary);
    }

    return result;
  }

  // ========================================================================
  // 公共方法 - 事件监听
  // ========================================================================

  /**
   * 添加信号监听器
   * @param listener - 监听器函数
   */
  onSignal(listener: StrategyEventListener<SignalEvent>): void {
    this.signalListeners.push(listener);
  }

  /**
   * 添加状态更新监听器
   * @param listener - 监听器函数
   */
  onStateUpdate(listener: StrategyEventListener<StateUpdateEvent>): void {
    this.stateListeners.push(listener);
  }

  /**
   * 添加机会监听器
   * @param listener - 监听器函数
   */
  onOpportunity(listener: StrategyEventListener<OpportunityEvent>): void {
    this.opportunityListeners.push(listener);
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(): void {
    this.signalListeners = [];
    this.stateListeners = [];
    this.opportunityListeners = [];
  }

  // ========================================================================
  // 私有方法 - 信号生成
  // ========================================================================

  /**
   * 生成开仓信号
   * @param symbol - 交易对
   * @param opportunity - 套利机会
   */
  private generateOpenSignal(
    symbol: string,
    opportunity: ArbitrageOpportunity
  ): TradeSignal | undefined {
    // 计算仓位大小
    const positionSize = this.positionSizer.calculatePositionSize({
      equity: this.state.equity,
      availableBalance: this.state.equity * 0.9, // 假设 90% 可用
      usedMargin: this.positionSizer.getTotalPosition() / 3, // 假设 3 倍杠杆
      opportunity,
      volatility: 0.02, // 假设 2% 波动率
      riskFactor: this.state.currentDrawdown / this.config.targetMaxDrawdown,
    });

    // 如果建议仓位太小，不开仓
    if (positionSize.suggestedNotional < positionSize.minNotional) {
      return undefined;
    }

    // 创建开仓信号
    return {
      id: generateId(),
      type: 'open',
      symbol,
      opportunity,
      strength: opportunity.suggestedSize,
      reason: `检测到套利机会：${opportunity.longExchange} 做多 vs ${opportunity.shortExchange} 做空，年化利差 ${(opportunity.spreadAnnualized * 100).toFixed(2)}%`,
      generatedAt: Date.now(),
      validUntil: opportunity.validUntil,
    };
  }

  /**
   * 生成平仓信号
   * @param symbol - 交易对
   * @param reason - 平仓原因
   */
  private generateCloseSignal(
    symbol: string,
    reason: string
  ): TradeSignal | undefined {
    // 获取库存
    const inventory = this.inventoryManager.getTotalInventory(symbol);

    // 如果没有库存，不生成信号
    if (!inventory || inventory.totalNotional === 0) {
      return undefined;
    }

    // 创建平仓信号
    return {
      id: generateId(),
      type: 'close',
      symbol,
      strength: 1.0, // 完全平仓
      reason,
      generatedAt: Date.now(),
      validUntil: Date.now() + 5 * 60 * 1000, // 5 分钟有效
    };
  }

  /**
   * 生成再平衡信号
   * @param symbol - 交易对
   */
  private generateRebalanceSignal(symbol: string): TradeSignal | undefined {
    // 生成再平衡操作
    const actions = this.inventoryManager.generateRebalanceActions(symbol);

    // 如果没有操作，不生成信号
    if (actions.length === 0) {
      return undefined;
    }

    // 记录再平衡
    this.inventoryManager.recordRebalance(symbol);

    // 创建再平衡信号
    return {
      id: generateId(),
      type: 'rebalance',
      symbol,
      rebalanceActions: actions,
      strength: 0.8, // 再平衡优先级较高
      reason: `库存偏离度 ${(this.inventoryManager.getImbalanceRatio(symbol) * 100).toFixed(1)}% 超过阈值`,
      generatedAt: Date.now(),
      validUntil: Date.now() + 10 * 60 * 1000, // 10 分钟有效
    };
  }

  /**
   * 检查是否需要平仓
   * @param symbol - 交易对
   */
  private checkForClose(symbol: string): TradeSignal | undefined {
    // 获取库存
    const inventory = this.inventoryManager.getTotalInventory(symbol);

    // 如果没有库存，不需要平仓
    if (!inventory || inventory.totalNotional === 0) {
      return undefined;
    }

    // 获取当前利差
    const maxSpread = this.arbitrageDetector.getMaxSpread(symbol);

    // 如果利差低于维持阈值，触发平仓
    if (!maxSpread || Math.abs(maxSpread.spread) < this.config.minSpreadToHold) {
      return this.generateCloseSignal(
        symbol,
        `利差 ${((maxSpread?.spread ?? 0) * 100).toFixed(2)}% 低于维持阈值 ${(this.config.minSpreadToHold * 100).toFixed(2)}%`
      );
    }

    return undefined;
  }

  // ========================================================================
  // 私有方法 - 夏普比率计算
  // ========================================================================

  /**
   * 记录收益
   * @param pnl - 收益金额
   * @param source - 收益来源
   */
  private recordPnl(pnl: number, source: 'trading' | 'funding'): void {
    // 添加记录
    this.pnlHistory.push({
      timestamp: Date.now(),
      pnl,
      source,
    });

    // 累计当日收益
    this.currentDayPnl += pnl;

    // 限制历史大小（保留 365 天）
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    this.pnlHistory = this.pnlHistory.filter((r) => r.timestamp > oneYearAgo);
  }

  /**
   * 检查日期变化
   */
  private checkDateChange(): void {
    // 获取当前日期
    const today = new Date().toISOString().split('T')[0]!;

    // 如果日期变化
    if (today !== this.currentDate) {
      // 记录昨日收益
      this.recordDailyReturn();

      // 更新日期
      this.currentDate = today;
      this.currentDayPnl = 0;
    }
  }

  /**
   * 记录日收益率
   */
  private recordDailyReturn(): void {
    // 计算日收益率
    const dailyReturn = this.currentDayPnl / this.state.equity;

    // 添加到记录
    this.dailyReturns.push(dailyReturn);

    // 限制记录数量（保留 365 天）
    if (this.dailyReturns.length > 365) {
      this.dailyReturns.shift();
    }
  }

  /**
   * 更新夏普比率
   */
  private updateSharpeRatio(): void {
    // 如果日收益记录不足，返回
    if (this.dailyReturns.length < 30) {
      return;
    }

    // 计算平均日收益率
    const meanReturn = this.dailyReturns.reduce((a, b) => a + b, 0) / this.dailyReturns.length;

    // 计算日收益率标准差
    const variance = this.dailyReturns.reduce(
      (acc, r) => acc + Math.pow(r - meanReturn, 2),
      0
    ) / this.dailyReturns.length;
    const stdDev = Math.sqrt(variance);

    // 计算年化夏普比率
    // 假设无风险利率为 2%
    const riskFreeRate = 0.02 / 365; // 日无风险利率
    const excessReturn = meanReturn - riskFreeRate;

    // 夏普比率 = 超额收益 / 标准差 * sqrt(365)
    if (stdDev > 0) {
      this.state.sharpeRatio = (excessReturn / stdDev) * Math.sqrt(365);
    }
  }

  // ========================================================================
  // 私有方法 - 事件触发
  // ========================================================================

  /**
   * 触发信号事件
   * @param signal - 信号
   */
  private emitSignal(signal: TradeSignal): void {
    const event: SignalEvent = {
      signal,
      timestamp: Date.now(),
    };

    for (const listener of this.signalListeners) {
      try {
        listener(event);
      } catch (error) {
        // 忽略监听器错误
      }
    }
  }

  /**
   * 触发状态更新事件
   * @param oldState - 旧状态
   * @param newState - 新状态
   */
  private emitStateUpdate(oldState: StrategyState, newState: StrategyState): void {
    const event: StateUpdateEvent = {
      oldState,
      newState,
      timestamp: Date.now(),
    };

    for (const listener of this.stateListeners) {
      try {
        listener(event);
      } catch (error) {
        // 忽略监听器错误
      }
    }
  }

  /**
   * 触发机会事件
   * @param opportunities - 机会列表
   */
  private emitOpportunity(opportunities: ArbitrageOpportunity[]): void {
    const event: OpportunityEvent = {
      opportunities,
      bestOpportunity: opportunities[0],
      timestamp: Date.now(),
    };

    for (const listener of this.opportunityListeners) {
      try {
        listener(event);
      } catch (error) {
        // 忽略监听器错误
      }
    }
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 创建初始状态
   */
  private createInitialState(): StrategyState {
    return {
      running: false,
      paused: false,
      equity: 0,
      initialEquity: 0,
      totalPnl: 0,
      totalFundingPnl: 0,
      totalFees: 0,
      currentDrawdown: 0,
      maxDrawdown: 0,
      peakEquity: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      sharpeRatio: 0,
      startedAt: 0,
      updatedAt: Date.now(),
    };
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建资金费率套利策略
 * @param config - 配置（可选）
 */
export function createFundingArbitrageStrategy(
  config?: Partial<FundingArbitrageConfig>
): FundingArbitrageStrategy {
  return new FundingArbitrageStrategy(config);
}
