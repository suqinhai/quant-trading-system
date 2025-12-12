// ============================================================================
// 风险管理器（单例模式）
// 实时监控账户风险，触发紧急风控措施
// 核心功能：保证金监控、仓位报警、BTC崩盘检测、强平价计算、PnL回撤监控
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type PositionSide,
} from './types';

// ============================================================================
// 类型定义
// ============================================================================

// 风险管理配置
export interface RiskManagerConfig {
  // === 保证金风控 ===
  // 总保证金率低于此值触发全平（默认 35%）
  minMarginRatio: number;

  // === 仓位集中度风控 ===
  // 单币种仓位占比超过此值报警（默认 12%）
  maxPositionRatio: number;

  // === BTC 崩盘风控 ===
  // BTC 跌幅监控窗口（毫秒，默认 10 分钟）
  btcCrashWindow: number;
  // BTC 跌幅阈值（默认 6%）
  btcCrashThreshold: number;
  // 山寨币减仓比例（默认 70%）
  altcoinReduceRatio: number;

  // === PnL 回撤风控 ===
  // 当日 PnL 回撤阈值（默认 7%）
  maxDailyDrawdown: number;

  // === 强平价计算 ===
  // 强平价更新间隔（毫秒，默认 1000）
  liquidationUpdateInterval: number;

  // === 风控冷却 ===
  // 风控触发后冷却时间（毫秒，默认 5 分钟）
  cooldownPeriod: number;
}

// 默认风险管理配置
const DEFAULT_RISK_MANAGER_CONFIG: RiskManagerConfig = {
  // 保证金率 < 35% 全平
  minMarginRatio: 0.35,
  // 单币种 > 12% 报警
  maxPositionRatio: 0.12,
  // BTC 10 分钟跌幅
  btcCrashWindow: 10 * 60 * 1000,
  // 跌幅 > 6%
  btcCrashThreshold: 0.06,
  // 山寨币减仓 70%
  altcoinReduceRatio: 0.70,
  // 当日回撤 > 7%
  maxDailyDrawdown: 0.07,
  // 每秒更新强平价
  liquidationUpdateInterval: 1000,
  // 冷却 5 分钟
  cooldownPeriod: 5 * 60 * 1000,
};

// 持仓信息
export interface PositionInfo {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 持仓方向
  side: PositionSide;
  // 持仓数量
  quantity: number;
  // 持仓价值（USDT）
  notionalValue: number;
  // 开仓均价
  entryPrice: number;
  // 当前价格
  currentPrice: number;
  // 杠杆倍数
  leverage: number;
  // 保证金
  margin: number;
  // 未实现盈亏
  unrealizedPnl: number;
  // 维持保证金率
  maintenanceMarginRate: number;
  // 更新时间
  updatedAt: Timestamp;
}

// 账户信息
export interface AccountInfo {
  // 交易所
  exchange: ExchangeId;
  // 总权益
  totalEquity: number;
  // 可用余额
  availableBalance: number;
  // 总保证金
  totalMargin: number;
  // 总持仓价值
  totalNotional: number;
  // 保证金率（权益 / 持仓价值）
  marginRatio: number;
  // 未实现盈亏
  unrealizedPnl: number;
  // 更新时间
  updatedAt: Timestamp;
}

// 强平价信息
export interface LiquidationInfo {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 持仓方向
  side: PositionSide;
  // 当前价格
  currentPrice: number;
  // 预估强平价
  liquidationPrice: number;
  // 距离强平的价格距离（百分比）
  distancePercent: number;
  // 是否危险（距离 < 5%）
  isDangerous: boolean;
  // 计算时间
  calculatedAt: Timestamp;
}

// BTC 价格记录
interface BtcPriceRecord {
  // 价格
  price: number;
  // 时间戳
  timestamp: Timestamp;
}

// 风控事件类型
export type RiskEventType =
  | 'margin_call'           // 保证金不足
  | 'position_alert'        // 仓位集中度报警
  | 'btc_crash'             // BTC 崩盘
  | 'daily_drawdown'        // 当日回撤超限
  | 'liquidation_warning'   // 强平预警
  | 'emergency_close';      // 紧急平仓

// 风控事件
export interface RiskEvent {
  // 事件类型
  type: RiskEventType;
  // 事件级别
  level: 'warning' | 'critical' | 'emergency';
  // 事件消息
  message: string;
  // 事件详情
  details: Record<string, unknown>;
  // 触发时间
  triggeredAt: Timestamp;
  // 是否已处理
  handled: boolean;
}

// 风控状态
export interface RiskState {
  // 是否启用
  enabled: boolean;
  // 是否暂停所有策略
  strategiesPaused: boolean;
  // 暂停原因
  pauseReason?: string;
  // 当日起始权益
  dailyStartEquity: number;
  // 当前权益
  currentEquity: number;
  // 当日 PnL
  dailyPnl: number;
  // 当日回撤
  dailyDrawdown: number;
  // 当日峰值权益
  dailyPeakEquity: number;
  // 最后风控触发时间
  lastTriggerTime: Timestamp;
  // 风控触发次数
  triggerCount: number;
  // 当前日期
  currentDate: string;
}

// 执行器接口（用于紧急平仓）
export interface Executor {
  // 紧急全平
  emergencyCloseAll(): Promise<void>;
  // 减仓指定比例
  reducePosition(
    exchange: ExchangeId,
    symbol: string,
    reduceRatio: number
  ): Promise<void>;
  // 暂停所有策略
  pauseAllStrategies(reason: string): void;
  // 恢复所有策略
  resumeAllStrategies(): void;
}

// 事件监听器类型
type RiskEventListener = (event: RiskEvent) => void;

// ============================================================================
// 风险管理器类（单例）
// ============================================================================

/**
 * 风险管理器（单例模式）
 * 实时监控各类风险指标，触发风控措施
 */
export class RiskManager {
  // ========================================================================
  // 单例实例
  // ========================================================================

  // 单例实例
  private static instance: RiskManager | null = null;

  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: RiskManagerConfig;

  // 执行器引用
  private executor: Executor | null = null;

  // 风控状态
  private state: RiskState;

  // 各交易所账户信息
  private accounts: Map<ExchangeId, AccountInfo> = new Map();

  // 所有持仓信息（exchange:symbol -> position）
  private positions: Map<string, PositionInfo> = new Map();

  // 强平价缓存（exchange:symbol -> liquidation info）
  private liquidationCache: Map<string, LiquidationInfo> = new Map();

  // BTC 价格历史（用于崩盘检测）
  private btcPriceHistory: BtcPriceRecord[] = [];

  // 当前 BTC 价格
  private currentBtcPrice: number = 0;

  // 事件监听器
  private eventListeners: RiskEventListener[] = [];

  // 强平价更新定时器
  private liquidationTimer: ReturnType<typeof setInterval> | null = null;

  // 日期检查定时器
  private dateCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ========================================================================
  // 构造函数（私有，防止外部实例化）
  // ========================================================================

  /**
   * 私有构造函数
   * @param config - 风险管理配置
   */
  private constructor(config?: Partial<RiskManagerConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_RISK_MANAGER_CONFIG, ...config };

    // 初始化状态
    this.state = this.createInitialState();
  }

  // ========================================================================
  // 单例方法
  // ========================================================================

  /**
   * 获取单例实例
   * @param config - 配置（仅首次调用时有效）
   */
  static getInstance(config?: Partial<RiskManagerConfig>): RiskManager {
    // 如果实例不存在，创建新实例
    if (!RiskManager.instance) {
      RiskManager.instance = new RiskManager(config);
    }

    // 返回单例实例
    return RiskManager.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    // 如果存在实例，先停止
    if (RiskManager.instance) {
      RiskManager.instance.stop();
    }

    // 清除实例
    RiskManager.instance = null;
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动风险管理器
   * @param executor - 执行器实例
   * @param initialEquity - 初始权益
   */
  start(executor: Executor, initialEquity: number): void {
    // 保存执行器引用
    this.executor = executor;

    // 设置初始权益
    this.state.dailyStartEquity = initialEquity;
    this.state.currentEquity = initialEquity;
    this.state.dailyPeakEquity = initialEquity;

    // 设置当前日期
    this.state.currentDate = this.getCurrentDate();

    // 启用风控
    this.state.enabled = true;

    // 启动强平价更新定时器
    this.startLiquidationTimer();

    // 启动日期检查定时器
    this.startDateCheckTimer();
  }

  /**
   * 停止风险管理器
   */
  stop(): void {
    // 禁用风控
    this.state.enabled = false;

    // 停止定时器
    this.stopLiquidationTimer();
    this.stopDateCheckTimer();

    // 清除执行器引用
    this.executor = null;
  }

  /**
   * 重置风控状态
   */
  reset(): void {
    // 停止
    this.stop();

    // 清空数据
    this.accounts.clear();
    this.positions.clear();
    this.liquidationCache.clear();
    this.btcPriceHistory = [];
    this.currentBtcPrice = 0;

    // 重置状态
    this.state = this.createInitialState();
  }

  // ========================================================================
  // 公共方法 - 数据更新
  // ========================================================================

  /**
   * 更新账户信息
   * @param account - 账户信息
   */
  updateAccount(account: AccountInfo): void {
    // 保存账户信息
    this.accounts.set(account.exchange, {
      ...account,
      updatedAt: Date.now(),
    });

    // 更新总权益
    this.updateTotalEquity();

    // 检查保证金率风控
    this.checkMarginRatio();
  }

  /**
   * 更新持仓信息
   * @param position - 持仓信息
   */
  updatePosition(position: PositionInfo): void {
    // 生成缓存键
    const key = this.getPositionKey(position.exchange, position.symbol);

    // 保存持仓信息
    this.positions.set(key, {
      ...position,
      updatedAt: Date.now(),
    });

    // 检查仓位集中度
    this.checkPositionConcentration(position);

    // 更新强平价
    this.updateLiquidationPrice(position);
  }

  /**
   * 批量更新持仓
   * @param positions - 持仓列表
   */
  updatePositions(positions: PositionInfo[]): void {
    // 遍历更新
    for (const position of positions) {
      this.updatePosition(position);
    }
  }

  /**
   * 更新 BTC 价格
   * @param price - BTC 当前价格
   */
  updateBtcPrice(price: number): void {
    // 记录当前时间
    const now = Date.now();

    // 保存当前价格
    this.currentBtcPrice = price;

    // 添加到历史记录
    this.btcPriceHistory.push({
      price,
      timestamp: now,
    });

    // 清理过期记录（保留窗口时间内的记录）
    const windowStart = now - this.config.btcCrashWindow;
    this.btcPriceHistory = this.btcPriceHistory.filter(
      (record) => record.timestamp >= windowStart
    );

    // 检查 BTC 崩盘
    this.checkBtcCrash();
  }

  /**
   * 更新权益
   * @param equity - 当前总权益
   */
  updateEquity(equity: number): void {
    // 检查日期变化
    this.checkDateChange();

    // 更新当前权益
    this.state.currentEquity = equity;

    // 更新峰值权益
    if (equity > this.state.dailyPeakEquity) {
      this.state.dailyPeakEquity = equity;
    }

    // 计算当日 PnL
    this.state.dailyPnl = equity - this.state.dailyStartEquity;

    // 计算当日回撤
    this.state.dailyDrawdown = 1 - equity / this.state.dailyPeakEquity;

    // 检查 PnL 回撤
    this.checkDailyDrawdown();
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取风控状态
   */
  getState(): RiskState {
    return { ...this.state };
  }

  /**
   * 获取配置
   */
  getConfig(): RiskManagerConfig {
    return { ...this.config };
  }

  /**
   * 获取所有强平价信息
   */
  getLiquidationInfos(): LiquidationInfo[] {
    return Array.from(this.liquidationCache.values());
  }

  /**
   * 获取指定持仓的强平价
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getLiquidationInfo(
    exchange: ExchangeId,
    symbol: string
  ): LiquidationInfo | undefined {
    const key = this.getPositionKey(exchange, symbol);
    return this.liquidationCache.get(key);
  }

  /**
   * 获取总保证金率
   */
  getTotalMarginRatio(): number {
    // 汇总所有交易所
    let totalEquity = 0;
    let totalNotional = 0;

    // 遍历所有账户
    for (const account of this.accounts.values()) {
      totalEquity += account.totalEquity;
      totalNotional += account.totalNotional;
    }

    // 如果没有持仓，返回 1（100%）
    if (totalNotional === 0) {
      return 1;
    }

    // 计算保证金率
    return totalEquity / totalNotional;
  }

  /**
   * 获取单币种仓位占比
   * @param symbol - 交易对（不含交易所前缀）
   */
  getPositionRatio(symbol: string): number {
    // 计算该币种在所有交易所的总仓位
    let symbolNotional = 0;

    // 遍历所有持仓
    for (const position of this.positions.values()) {
      // 检查是否是同一币种（忽略交易所差异）
      if (this.isSameSymbol(position.symbol, symbol)) {
        symbolNotional += position.notionalValue;
      }
    }

    // 计算占比
    return this.state.currentEquity > 0
      ? symbolNotional / this.state.currentEquity
      : 0;
  }

  /**
   * 获取 BTC 近期跌幅
   */
  getBtcDropPercent(): number {
    // 如果历史记录不足，返回 0
    if (this.btcPriceHistory.length < 2) {
      return 0;
    }

    // 获取窗口内最高价
    const maxPrice = Math.max(...this.btcPriceHistory.map((r) => r.price));

    // 计算跌幅
    return (maxPrice - this.currentBtcPrice) / maxPrice;
  }

  /**
   * 检查是否可以开新仓
   */
  canOpenPosition(): { allowed: boolean; reason?: string } {
    // 检查是否启用
    if (!this.state.enabled) {
      return { allowed: false, reason: '风控已禁用' };
    }

    // 检查策略是否暂停
    if (this.state.strategiesPaused) {
      return { allowed: false, reason: this.state.pauseReason };
    }

    // 检查保证金率
    const marginRatio = this.getTotalMarginRatio();
    if (marginRatio < this.config.minMarginRatio * 1.5) {
      // 保证金率低于阈值的 1.5 倍时，不允许开新仓
      return {
        allowed: false,
        reason: `保证金率 ${(marginRatio * 100).toFixed(1)}% 过低`,
      };
    }

    // 检查当日回撤
    if (this.state.dailyDrawdown > this.config.maxDailyDrawdown * 0.8) {
      // 接近回撤阈值时，不允许开新仓
      return {
        allowed: false,
        reason: `当日回撤 ${(this.state.dailyDrawdown * 100).toFixed(1)}% 接近阈值`,
      };
    }

    return { allowed: true };
  }

  // ========================================================================
  // 公共方法 - 事件监听
  // ========================================================================

  /**
   * 添加事件监听器
   * @param listener - 监听器函数
   */
  onRiskEvent(listener: RiskEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除事件监听器
   * @param listener - 监听器函数
   */
  offRiskEvent(listener: RiskEventListener): void {
    const index = this.eventListeners.indexOf(listener);
    if (index !== -1) {
      this.eventListeners.splice(index, 1);
    }
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(): void {
    this.eventListeners = [];
  }

  // ========================================================================
  // 私有方法 - 风控检查
  // ========================================================================

  /**
   * 检查保证金率
   */
  private checkMarginRatio(): void {
    // 检查是否启用
    if (!this.state.enabled) {
      return;
    }

    // 检查冷却期
    if (this.isInCooldown()) {
      return;
    }

    // 获取总保证金率
    const marginRatio = this.getTotalMarginRatio();

    // 检查是否低于阈值
    if (marginRatio < this.config.minMarginRatio) {
      // 触发紧急全平
      this.triggerEmergencyClose(
        'margin_call',
        `总保证金率 ${(marginRatio * 100).toFixed(2)}% 低于阈值 ${(this.config.minMarginRatio * 100).toFixed(2)}%`,
        { marginRatio, threshold: this.config.minMarginRatio }
      );
    }
  }

  /**
   * 检查仓位集中度
   * @param position - 持仓信息
   */
  private checkPositionConcentration(position: PositionInfo): void {
    // 检查是否启用
    if (!this.state.enabled) {
      return;
    }

    // 计算该币种总仓位占比
    const positionRatio = this.getPositionRatio(position.symbol);

    // 检查是否超过阈值
    if (positionRatio > this.config.maxPositionRatio) {
      // 触发仓位报警（不平仓，只报警）
      this.emitRiskEvent({
        type: 'position_alert',
        level: 'warning',
        message: `${position.symbol} 仓位占比 ${(positionRatio * 100).toFixed(2)}% 超过阈值 ${(this.config.maxPositionRatio * 100).toFixed(2)}%`,
        details: {
          symbol: position.symbol,
          positionRatio,
          threshold: this.config.maxPositionRatio,
          notionalValue: position.notionalValue,
        },
        triggeredAt: Date.now(),
        handled: false,
      });
    }
  }

  /**
   * 检查 BTC 崩盘
   */
  private checkBtcCrash(): void {
    // 检查是否启用
    if (!this.state.enabled) {
      return;
    }

    // 检查冷却期
    if (this.isInCooldown()) {
      return;
    }

    // 获取 BTC 跌幅
    const dropPercent = this.getBtcDropPercent();

    // 检查是否超过阈值
    if (dropPercent >= this.config.btcCrashThreshold) {
      // 触发山寨币减仓
      this.triggerAltcoinReduce(
        `BTC ${this.config.btcCrashWindow / 60000} 分钟跌幅 ${(dropPercent * 100).toFixed(2)}% 超过阈值 ${(this.config.btcCrashThreshold * 100).toFixed(2)}%`,
        { btcDrop: dropPercent, threshold: this.config.btcCrashThreshold }
      );
    }
  }

  /**
   * 检查当日 PnL 回撤
   */
  private checkDailyDrawdown(): void {
    // 检查是否启用
    if (!this.state.enabled) {
      return;
    }

    // 检查冷却期
    if (this.isInCooldown()) {
      return;
    }

    // 检查是否超过阈值
    if (this.state.dailyDrawdown >= this.config.maxDailyDrawdown) {
      // 触发紧急全平
      this.triggerEmergencyClose(
        'daily_drawdown',
        `当日 PnL 回撤 ${(this.state.dailyDrawdown * 100).toFixed(2)}% 超过阈值 ${(this.config.maxDailyDrawdown * 100).toFixed(2)}%`,
        {
          dailyDrawdown: this.state.dailyDrawdown,
          threshold: this.config.maxDailyDrawdown,
          dailyPnl: this.state.dailyPnl,
        }
      );
    }
  }

  // ========================================================================
  // 私有方法 - 强平价计算
  // ========================================================================

  /**
   * 更新强平价
   * @param position - 持仓信息
   */
  private updateLiquidationPrice(position: PositionInfo): void {
    // 生成缓存键
    const key = this.getPositionKey(position.exchange, position.symbol);

    // 如果没有持仓，删除缓存
    if (position.side === 'none' || position.quantity === 0) {
      this.liquidationCache.delete(key);
      return;
    }

    // 计算强平价
    const liquidationPrice = this.calculateLiquidationPrice(position);

    // 计算距离强平的价格距离
    const distancePercent = Math.abs(
      (liquidationPrice - position.currentPrice) / position.currentPrice
    );

    // 判断是否危险（距离 < 5%）
    const isDangerous = distancePercent < 0.05;

    // 创建强平价信息
    const liquidationInfo: LiquidationInfo = {
      exchange: position.exchange,
      symbol: position.symbol,
      side: position.side,
      currentPrice: position.currentPrice,
      liquidationPrice,
      distancePercent,
      isDangerous,
      calculatedAt: Date.now(),
    };

    // 保存到缓存
    this.liquidationCache.set(key, liquidationInfo);

    // 如果危险，触发预警
    if (isDangerous) {
      this.emitRiskEvent({
        type: 'liquidation_warning',
        level: 'critical',
        message: `${position.symbol} 距离强平价仅 ${(distancePercent * 100).toFixed(2)}%`,
        details: {
          ...liquidationInfo,
        },
        triggeredAt: Date.now(),
        handled: false,
      });
    }
  }

  /**
   * 计算强平价
   * @param position - 持仓信息
   */
  private calculateLiquidationPrice(position: PositionInfo): number {
    // 获取维持保证金率（默认使用 0.4%，实际应从交易所获取）
    const maintenanceMarginRate = position.maintenanceMarginRate || 0.004;

    // 获取开仓均价
    const entryPrice = position.entryPrice;

    // 获取杠杆
    const leverage = position.leverage;

    // 计算强平价
    // 多头强平价 = 开仓价 * (1 - 1/杠杆 + 维持保证金率)
    // 空头强平价 = 开仓价 * (1 + 1/杠杆 - 维持保证金率)
    if (position.side === 'long') {
      // 多头：价格下跌到强平价
      return entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
    } else {
      // 空头：价格上涨到强平价
      return entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
    }
  }

  /**
   * 更新所有强平价
   */
  private updateAllLiquidationPrices(): void {
    // 遍历所有持仓
    for (const position of this.positions.values()) {
      // 跳过无持仓
      if (position.side === 'none' || position.quantity === 0) {
        continue;
      }

      // 更新强平价
      this.updateLiquidationPrice(position);
    }
  }

  // ========================================================================
  // 私有方法 - 风控触发
  // ========================================================================

  /**
   * 触发紧急全平
   * @param type - 事件类型
   * @param message - 事件消息
   * @param details - 事件详情
   */
  private async triggerEmergencyClose(
    type: RiskEventType,
    message: string,
    details: Record<string, unknown>
  ): Promise<void> {
    // 记录触发时间
    this.state.lastTriggerTime = Date.now();
    this.state.triggerCount++;

    // 发送风控事件
    this.emitRiskEvent({
      type,
      level: 'emergency',
      message,
      details,
      triggeredAt: Date.now(),
      handled: false,
    });

    // 暂停所有策略
    this.state.strategiesPaused = true;
    this.state.pauseReason = message;

    // 调用执行器紧急全平
    if (this.executor) {
      try {
        // 暂停策略
        this.executor.pauseAllStrategies(message);

        // 执行紧急全平
        await this.executor.emergencyCloseAll();

        // 发送紧急平仓事件
        this.emitRiskEvent({
          type: 'emergency_close',
          level: 'emergency',
          message: `紧急全平已执行：${message}`,
          details: { ...details, success: true },
          triggeredAt: Date.now(),
          handled: true,
        });
      } catch (error) {
        // 发送错误事件
        this.emitRiskEvent({
          type: 'emergency_close',
          level: 'emergency',
          message: `紧急全平失败：${error}`,
          details: { ...details, success: false, error: String(error) },
          triggeredAt: Date.now(),
          handled: false,
        });
      }
    }
  }

  /**
   * 触发山寨币减仓
   * @param message - 事件消息
   * @param details - 事件详情
   */
  private async triggerAltcoinReduce(
    message: string,
    details: Record<string, unknown>
  ): Promise<void> {
    // 记录触发时间
    this.state.lastTriggerTime = Date.now();
    this.state.triggerCount++;

    // 发送风控事件
    this.emitRiskEvent({
      type: 'btc_crash',
      level: 'critical',
      message,
      details,
      triggeredAt: Date.now(),
      handled: false,
    });

    // 调用执行器减仓山寨币
    if (this.executor) {
      // 遍历所有持仓
      for (const position of this.positions.values()) {
        // 跳过 BTC 持仓
        if (this.isBtcPosition(position.symbol)) {
          continue;
        }

        // 跳过无持仓
        if (position.side === 'none' || position.quantity === 0) {
          continue;
        }

        try {
          // 减仓指定比例
          await this.executor.reducePosition(
            position.exchange,
            position.symbol,
            this.config.altcoinReduceRatio
          );
        } catch (error) {
          // 记录错误但继续处理其他持仓
          console.error(
            `减仓失败: ${position.exchange}:${position.symbol}`,
            error
          );
        }
      }
    }
  }

  // ========================================================================
  // 私有方法 - 定时器
  // ========================================================================

  /**
   * 启动强平价更新定时器
   */
  private startLiquidationTimer(): void {
    // 如果已存在，先停止
    this.stopLiquidationTimer();

    // 创建定时器
    this.liquidationTimer = setInterval(() => {
      // 更新所有强平价
      this.updateAllLiquidationPrices();
    }, this.config.liquidationUpdateInterval);
  }

  /**
   * 停止强平价更新定时器
   */
  private stopLiquidationTimer(): void {
    if (this.liquidationTimer) {
      clearInterval(this.liquidationTimer);
      this.liquidationTimer = null;
    }
  }

  /**
   * 启动日期检查定时器
   */
  private startDateCheckTimer(): void {
    // 如果已存在，先停止
    this.stopDateCheckTimer();

    // 每分钟检查一次日期
    this.dateCheckTimer = setInterval(() => {
      this.checkDateChange();
    }, 60 * 1000);
  }

  /**
   * 停止日期检查定时器
   */
  private stopDateCheckTimer(): void {
    if (this.dateCheckTimer) {
      clearInterval(this.dateCheckTimer);
      this.dateCheckTimer = null;
    }
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 创建初始状态
   */
  private createInitialState(): RiskState {
    return {
      enabled: false,
      strategiesPaused: false,
      dailyStartEquity: 0,
      currentEquity: 0,
      dailyPnl: 0,
      dailyDrawdown: 0,
      dailyPeakEquity: 0,
      lastTriggerTime: 0,
      triggerCount: 0,
      currentDate: this.getCurrentDate(),
    };
  }

  /**
   * 获取当前日期
   */
  private getCurrentDate(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /**
   * 检查日期变化
   */
  private checkDateChange(): void {
    // 获取当前日期
    const today = this.getCurrentDate();

    // 如果日期变化
    if (today !== this.state.currentDate) {
      // 重置当日数据
      this.state.currentDate = today;
      this.state.dailyStartEquity = this.state.currentEquity;
      this.state.dailyPeakEquity = this.state.currentEquity;
      this.state.dailyPnl = 0;
      this.state.dailyDrawdown = 0;

      // 如果之前暂停了策略，尝试恢复
      if (this.state.strategiesPaused && this.executor) {
        // 检查是否可以恢复
        const marginRatio = this.getTotalMarginRatio();
        if (marginRatio >= this.config.minMarginRatio * 1.5) {
          // 恢复策略
          this.state.strategiesPaused = false;
          this.state.pauseReason = undefined;
          this.executor.resumeAllStrategies();
        }
      }
    }
  }

  /**
   * 更新总权益
   */
  private updateTotalEquity(): void {
    // 汇总所有交易所权益
    let totalEquity = 0;

    // 遍历所有账户
    for (const account of this.accounts.values()) {
      totalEquity += account.totalEquity;
    }

    // 更新权益
    this.updateEquity(totalEquity);
  }

  /**
   * 检查是否在冷却期
   */
  private isInCooldown(): boolean {
    // 如果从未触发，不在冷却期
    if (this.state.lastTriggerTime === 0) {
      return false;
    }

    // 检查是否超过冷却时间
    return Date.now() - this.state.lastTriggerTime < this.config.cooldownPeriod;
  }

  /**
   * 生成持仓键
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  private getPositionKey(exchange: ExchangeId, symbol: string): string {
    return `${exchange}:${symbol}`;
  }

  /**
   * 检查是否是同一币种
   * @param symbol1 - 交易对1
   * @param symbol2 - 交易对2
   */
  private isSameSymbol(symbol1: string, symbol2: string): boolean {
    // 提取基础币种（如 BTC/USDT:USDT -> BTC）
    const base1 = symbol1.split('/')[0]?.toUpperCase();
    const base2 = symbol2.split('/')[0]?.toUpperCase();

    return base1 === base2;
  }

  /**
   * 检查是否是 BTC 持仓
   * @param symbol - 交易对
   */
  private isBtcPosition(symbol: string): boolean {
    // 提取基础币种
    const base = symbol.split('/')[0]?.toUpperCase();

    return base === 'BTC';
  }

  /**
   * 发送风控事件
   * @param event - 风控事件
   */
  private emitRiskEvent(event: RiskEvent): void {
    // 遍历所有监听器
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        // 忽略监听器错误
        console.error('风控事件监听器错误:', error);
      }
    }
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 获取风险管理器实例（单例）
 * @param config - 配置（仅首次调用时有效）
 */
export function getRiskManager(
  config?: Partial<RiskManagerConfig>
): RiskManager {
  return RiskManager.getInstance(config);
}

/**
 * 重置风险管理器（用于测试）
 */
export function resetRiskManager(): void {
  RiskManager.resetInstance();
}

// 导出默认配置
export { DEFAULT_RISK_MANAGER_CONFIG };
