// ============================================================================
// 账户管理模块
// 管理账户余额、保证金、持仓
// 实现杠杆、保证金率计算、强平逻辑
// ============================================================================

import {
  type ExchangeId,
  type OrderSide,
  type PositionSide,
  type Account,
  type Position,
  type Timestamp,
  type LiquidationEvent,
  getPositionKey,
  generateId,
} from './types.js';

// ============================================================================
// 账户配置
// ============================================================================

// 账户配置
export interface AccountConfig {
  // 初始余额（USDT）
  initialBalance: number;
  // 默认杠杆倍数
  defaultLeverage: number;
  // 最大杠杆倍数
  maxLeverage: number;
  // 维持保证金率（用于计算强平价格）
  maintenanceMarginRate: number;
  // 强平手续费率
  liquidationFeeRate: number;
  // 是否启用强平
  enableLiquidation: boolean;
}

// 默认账户配置
export const DEFAULT_ACCOUNT_CONFIG: AccountConfig = {
  // 初始余额 10000 USDT
  initialBalance: 10000,
  // 默认杠杆 10 倍
  defaultLeverage: 10,
  // 最大杠杆 125 倍
  maxLeverage: 125,
  // 维持保证金率 0.5%
  maintenanceMarginRate: 0.005,
  // 强平手续费率 0.5%
  liquidationFeeRate: 0.005,
  // 启用强平
  enableLiquidation: true,
};

// ============================================================================
// 交易结果类型
// ============================================================================

// 开仓结果
export interface OpenPositionResult {
  // 是否成功
  success: boolean;
  // 错误消息（失败时返回）
  error?: string;
  // 更新后的持仓（成功时返回）
  position?: Position;
  // 使用的保证金
  marginUsed?: number;
}

// 平仓结果
export interface ClosePositionResult {
  // 是否成功
  success: boolean;
  // 错误消息（失败时返回）
  error?: string;
  // 实现盈亏
  realizedPnl?: number;
  // 释放的保证金
  marginReleased?: number;
}

// 强平结果
export interface LiquidationResult {
  // 是否发生强平
  liquidated: boolean;
  // 强平事件列表
  events: LiquidationEvent[];
  // 总损失
  totalLoss: number;
}

// ============================================================================
// 账户管理器类
// ============================================================================

/**
 * 账户管理器
 * 管理账户余额、保证金、持仓、强平
 */
export class AccountManager {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 账户配置
  private config: AccountConfig;

  // 账户状态
  private _account: Account;

  // 持仓映射（按 exchange:symbol 索引）
  private positions: Map<string, Position> = new Map();

  // 当前时间戳
  private currentTimestamp: Timestamp = 0;

  // 强平回调
  private onLiquidation?: (event: LiquidationEvent) => void;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 账户配置（可选）
   */
  constructor(config?: Partial<AccountConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_ACCOUNT_CONFIG, ...config };

    // 初始化账户
    this._account = {
      balance: this.config.initialBalance,
      availableBalance: this.config.initialBalance,
      usedMargin: 0,
      totalUnrealizedPnl: 0,
      totalRealizedPnl: 0,
      totalFee: 0,
      totalFundingFee: 0,
      equity: this.config.initialBalance,
      marginRatio: 0,
      maxLeverage: this.config.maxLeverage,
      defaultLeverage: this.config.defaultLeverage,
      updatedAt: 0,
    };
  }

  // ========================================================================
  // 属性访问器
  // ========================================================================

  /**
   * 获取账户状态（只读）
   */
  get account(): Readonly<Account> {
    return this._account;
  }

  /**
   * 获取所有持仓（只读）
   */
  getPositions(): ReadonlyMap<string, Readonly<Position>> {
    return this.positions;
  }

  /**
   * 获取指定持仓
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getPosition(exchange: ExchangeId, symbol: string): Position | undefined {
    const key = getPositionKey(exchange, symbol);
    return this.positions.get(key);
  }

  /**
   * 获取持仓信息（用于撮合引擎）
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getPositionInfo(exchange: ExchangeId, symbol: string): { side: string; quantity: number } | undefined {
    const position = this.getPosition(exchange, symbol);
    if (!position || position.side === 'none') {
      return undefined;
    }
    return {
      side: position.side,
      quantity: position.quantity,
    };
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
   * 设置强平回调
   * @param callback - 回调函数
   */
  setLiquidationCallback(callback: (event: LiquidationEvent) => void): void {
    this.onLiquidation = callback;
  }

  // ========================================================================
  // 公共方法 - 开仓
  // ========================================================================

  /**
   * 开仓或加仓
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param side - 方向
   * @param quantity - 数量
   * @param price - 开仓价格
   * @param leverage - 杠杆倍数（可选，使用默认值）
   * @param fee - 手续费
   */
  openPosition(
    exchange: ExchangeId,
    symbol: string,
    side: OrderSide,
    quantity: number,
    price: number,
    leverage?: number,
    fee: number = 0
  ): OpenPositionResult {
    // 确定杠杆倍数
    const lev = leverage ?? this.config.defaultLeverage;

    // 验证杠杆
    if (lev > this.config.maxLeverage) {
      return {
        success: false,
        error: `Leverage ${lev} exceeds maximum ${this.config.maxLeverage}`,
      };
    }

    // 计算所需保证金
    const notional = price * quantity;
    const requiredMargin = notional / lev;

    // 检查可用余额
    if (requiredMargin > this._account.availableBalance) {
      return {
        success: false,
        error: `Insufficient margin: required ${requiredMargin.toFixed(2)}, available ${this._account.availableBalance.toFixed(2)}`,
      };
    }

    // 获取或创建持仓
    const key = getPositionKey(exchange, symbol);
    let position = this.positions.get(key);

    // 确定持仓方向
    const positionSide: PositionSide = side === 'buy' ? 'long' : 'short';

    if (!position) {
      // 创建新持仓
      position = {
        exchange,
        symbol,
        side: positionSide,
        quantity: 0,
        entryPrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        leverage: lev,
        marginMode: 'cross', // 默认全仓模式
        isolatedMargin: 0,
        liquidationPrice: 0,
        fundingFee: 0,
        updatedAt: this.currentTimestamp,
      };
      this.positions.set(key, position);
    }

    // 检查方向是否一致
    if (position.side !== 'none' && position.side !== positionSide) {
      // 方向相反，需要先平仓再开仓
      // 这里简化处理，返回错误
      return {
        success: false,
        error: `Position direction mismatch: existing ${position.side}, new ${positionSide}`,
      };
    }

    // 更新持仓
    const prevNotional = position.entryPrice * position.quantity;
    const newNotional = price * quantity;
    const totalQuantity = position.quantity + quantity;

    // 计算新的平均开仓价
    position.entryPrice = totalQuantity > 0
      ? (prevNotional + newNotional) / totalQuantity
      : 0;

    // 更新持仓数量和方向
    position.quantity = totalQuantity;
    position.side = positionSide;
    position.leverage = lev;
    position.updatedAt = this.currentTimestamp;

    // 计算强平价格
    position.liquidationPrice = this.calculateLiquidationPrice(position);

    // 更新账户
    this._account.usedMargin += requiredMargin;
    this._account.availableBalance -= requiredMargin;
    this._account.totalFee += fee;
    this._account.balance -= fee;
    this._account.updatedAt = this.currentTimestamp;

    // 更新账户状态
    this.updateAccountState();

    return {
      success: true,
      position,
      marginUsed: requiredMargin,
    };
  }

  // ========================================================================
  // 公共方法 - 平仓
  // ========================================================================

  /**
   * 平仓或减仓
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param quantity - 平仓数量
   * @param price - 平仓价格
   * @param fee - 手续费
   */
  closePosition(
    exchange: ExchangeId,
    symbol: string,
    quantity: number,
    price: number,
    fee: number = 0
  ): ClosePositionResult {
    // 获取持仓
    const key = getPositionKey(exchange, symbol);
    const position = this.positions.get(key);

    // 检查持仓是否存在
    if (!position || position.side === 'none' || position.quantity === 0) {
      return {
        success: false,
        error: 'No position to close',
      };
    }

    // 检查平仓数量
    const closeQuantity = Math.min(quantity, position.quantity);

    // 计算实现盈亏
    const realizedPnl = this.calculateRealizedPnl(position, closeQuantity, price);

    // 计算释放的保证金
    const closeNotional = position.entryPrice * closeQuantity;
    const marginReleased = closeNotional / position.leverage;

    // 更新持仓
    position.quantity -= closeQuantity;
    position.realizedPnl += realizedPnl;
    position.updatedAt = this.currentTimestamp;

    // 如果持仓为空，重置
    if (position.quantity <= 0) {
      position.quantity = 0;
      position.side = 'none';
      position.entryPrice = 0;
      position.liquidationPrice = 0;
    } else {
      // 重新计算强平价格
      position.liquidationPrice = this.calculateLiquidationPrice(position);
    }

    // 更新账户
    this._account.usedMargin -= marginReleased;
    this._account.availableBalance += marginReleased + realizedPnl;
    this._account.balance += realizedPnl;
    this._account.totalRealizedPnl += realizedPnl;
    this._account.totalFee += fee;
    this._account.balance -= fee;
    this._account.updatedAt = this.currentTimestamp;

    // 更新账户状态
    this.updateAccountState();

    return {
      success: true,
      realizedPnl,
      marginReleased,
    };
  }

  // ========================================================================
  // 公共方法 - 价格更新
  // ========================================================================

  /**
   * 更新标记价格（用于计算未实现盈亏和检查强平）
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param markPrice - 标记价格
   * @returns 强平结果
   */
  updateMarkPrice(
    exchange: ExchangeId,
    symbol: string,
    markPrice: number
  ): LiquidationResult {
    // 获取持仓
    const key = getPositionKey(exchange, symbol);
    const position = this.positions.get(key);

    // 没有持仓，跳过
    if (!position || position.side === 'none' || position.quantity === 0) {
      return { liquidated: false, events: [], totalLoss: 0 };
    }

    // 计算未实现盈亏
    position.unrealizedPnl = this.calculateUnrealizedPnl(position, markPrice);
    position.updatedAt = this.currentTimestamp;

    // 更新账户未实现盈亏
    this.updateAccountState();

    // 检查是否需要强平
    if (this.config.enableLiquidation) {
      return this.checkAndExecuteLiquidation(position, markPrice);
    }

    return { liquidated: false, events: [], totalLoss: 0 };
  }

  /**
   * 批量更新标记价格
   * @param prices - 价格映射（key: exchange:symbol, value: markPrice）
   * @returns 强平结果
   */
  updateMarkPrices(prices: Map<string, number>): LiquidationResult {
    // 收集强平事件
    const allEvents: LiquidationEvent[] = [];
    let totalLoss = 0;

    // 遍历价格
    for (const [key, markPrice] of prices) {
      // 解析 key
      const [exchange, symbol] = key.split(':') as [ExchangeId, string];

      // 更新价格
      const result = this.updateMarkPrice(exchange, symbol, markPrice);

      // 收集强平事件
      if (result.liquidated) {
        allEvents.push(...result.events);
        totalLoss += result.totalLoss;
      }
    }

    return {
      liquidated: allEvents.length > 0,
      events: allEvents,
      totalLoss,
    };
  }

  // ========================================================================
  // 公共方法 - 资金费用
  // ========================================================================

  /**
   * 扣除资金费用
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param fundingRate - 资金费率
   * @param markPrice - 标记价格
   * @returns 资金费用（正数为支出，负数为收入）
   */
  applyFundingFee(
    exchange: ExchangeId,
    symbol: string,
    fundingRate: number,
    markPrice: number
  ): number {
    // 获取持仓
    const key = getPositionKey(exchange, symbol);
    const position = this.positions.get(key);

    // 没有持仓，跳过
    if (!position || position.side === 'none' || position.quantity === 0) {
      return 0;
    }

    // 计算持仓价值
    const positionValue = position.quantity * markPrice;

    // 计算资金费用
    // 多头支付资金费率为正时的费用，空头收取
    // 多头收取资金费率为负时的费用，空头支付
    let fundingFee: number;

    if (position.side === 'long') {
      // 多头：费率为正时支付，为负时收取
      fundingFee = positionValue * fundingRate;
    } else {
      // 空头：费率为正时收取，为负时支付
      fundingFee = -positionValue * fundingRate;
    }

    // 更新持仓资金费用
    position.fundingFee += fundingFee;
    position.updatedAt = this.currentTimestamp;

    // 更新账户
    this._account.balance -= fundingFee;
    this._account.availableBalance -= fundingFee;
    this._account.totalFundingFee += fundingFee;
    this._account.updatedAt = this.currentTimestamp;

    // 更新账户状态
    this.updateAccountState();

    return fundingFee;
  }

  // ========================================================================
  // 公共方法 - 账户操作
  // ========================================================================

  /**
   * 存入资金
   * @param amount - 金额
   */
  deposit(amount: number): void {
    this._account.balance += amount;
    this._account.availableBalance += amount;
    this._account.updatedAt = this.currentTimestamp;
    this.updateAccountState();
  }

  /**
   * 提取资金
   * @param amount - 金额
   * @returns 是否成功
   */
  withdraw(amount: number): boolean {
    if (amount > this._account.availableBalance) {
      return false;
    }

    this._account.balance -= amount;
    this._account.availableBalance -= amount;
    this._account.updatedAt = this.currentTimestamp;
    this.updateAccountState();

    return true;
  }

  /**
   * 重置账户到初始状态
   */
  reset(): void {
    // 清空持仓
    this.positions.clear();

    // 重置账户
    this._account = {
      balance: this.config.initialBalance,
      availableBalance: this.config.initialBalance,
      usedMargin: 0,
      totalUnrealizedPnl: 0,
      totalRealizedPnl: 0,
      totalFee: 0,
      totalFundingFee: 0,
      equity: this.config.initialBalance,
      marginRatio: 0,
      maxLeverage: this.config.maxLeverage,
      defaultLeverage: this.config.defaultLeverage,
      updatedAt: this.currentTimestamp,
    };
  }

  // ========================================================================
  // 私有方法 - 盈亏计算
  // ========================================================================

  /**
   * 计算未实现盈亏
   * @param position - 持仓
   * @param markPrice - 标记价格
   */
  private calculateUnrealizedPnl(position: Position, markPrice: number): number {
    // 价格差
    const priceDiff = markPrice - position.entryPrice;

    // 多头：价格上涨盈利
    // 空头：价格下跌盈利
    if (position.side === 'long') {
      return priceDiff * position.quantity;
    } else {
      return -priceDiff * position.quantity;
    }
  }

  /**
   * 计算实现盈亏
   * @param position - 持仓
   * @param closeQuantity - 平仓数量
   * @param closePrice - 平仓价格
   */
  private calculateRealizedPnl(
    position: Position,
    closeQuantity: number,
    closePrice: number
  ): number {
    // 价格差
    const priceDiff = closePrice - position.entryPrice;

    // 多头：价格上涨盈利
    // 空头：价格下跌盈利
    if (position.side === 'long') {
      return priceDiff * closeQuantity;
    } else {
      return -priceDiff * closeQuantity;
    }
  }

  // ========================================================================
  // 私有方法 - 强平价格计算
  // ========================================================================

  /**
   * 计算强平价格
   * @param position - 持仓
   */
  private calculateLiquidationPrice(position: Position): number {
    // 如果没有持仓，返回 0
    if (position.quantity === 0 || position.side === 'none') {
      return 0;
    }

    // 持仓价值
    const positionValue = position.entryPrice * position.quantity;

    // 初始保证金
    const initialMargin = positionValue / position.leverage;

    // 维持保证金
    const maintenanceMargin = positionValue * this.config.maintenanceMarginRate;

    // 可亏损金额 = 初始保证金 - 维持保证金
    const maxLoss = initialMargin - maintenanceMargin;

    // 计算强平价格
    // 多头：强平价格 = 开仓价 - 可亏损金额 / 数量
    // 空头：强平价格 = 开仓价 + 可亏损金额 / 数量
    if (position.side === 'long') {
      return Math.max(0, position.entryPrice - maxLoss / position.quantity);
    } else {
      return position.entryPrice + maxLoss / position.quantity;
    }
  }

  // ========================================================================
  // 私有方法 - 强平检查和执行
  // ========================================================================

  /**
   * 检查并执行强平
   * @param position - 持仓
   * @param markPrice - 标记价格
   */
  private checkAndExecuteLiquidation(
    position: Position,
    markPrice: number
  ): LiquidationResult {
    // 检查是否触发强平
    let shouldLiquidate = false;

    if (position.side === 'long') {
      // 多头：标记价格 <= 强平价格时触发
      shouldLiquidate = markPrice <= position.liquidationPrice;
    } else if (position.side === 'short') {
      // 空头：标记价格 >= 强平价格时触发
      shouldLiquidate = markPrice >= position.liquidationPrice;
    }

    // 不需要强平
    if (!shouldLiquidate) {
      return { liquidated: false, events: [], totalLoss: 0 };
    }

    // 执行强平
    return this.executeLiquidation(position, markPrice);
  }

  /**
   * 执行强平
   * @param position - 持仓
   * @param liquidationPrice - 强平价格
   */
  private executeLiquidation(
    position: Position,
    liquidationPrice: number
  ): LiquidationResult {
    // 计算强平损失
    const positionValue = position.entryPrice * position.quantity;
    const initialMargin = positionValue / position.leverage;

    // 强平手续费
    const liquidationFee = positionValue * this.config.liquidationFeeRate;

    // 计算实际亏损（初始保证金 + 强平手续费）
    const loss = initialMargin + liquidationFee;

    // 创建强平事件
    const liquidationEvent: LiquidationEvent = {
      type: 'liquidation',
      timestamp: this.currentTimestamp,
      exchange: position.exchange,
      symbol: position.symbol,
      liquidationPrice,
      quantity: position.quantity,
      side: position.side,
      loss,
    };

    // 更新账户
    this._account.balance -= loss;
    this._account.usedMargin -= initialMargin;
    this._account.totalRealizedPnl -= loss;
    this._account.updatedAt = this.currentTimestamp;

    // 清空持仓
    position.quantity = 0;
    position.side = 'none';
    position.entryPrice = 0;
    position.unrealizedPnl = 0;
    position.realizedPnl -= loss;
    position.liquidationPrice = 0;
    position.updatedAt = this.currentTimestamp;

    // 更新账户状态
    this.updateAccountState();

    // 调用强平回调
    if (this.onLiquidation) {
      this.onLiquidation(liquidationEvent);
    }

    return {
      liquidated: true,
      events: [liquidationEvent],
      totalLoss: loss,
    };
  }

  // ========================================================================
  // 私有方法 - 账户状态更新
  // ========================================================================

  /**
   * 更新账户状态
   */
  private updateAccountState(): void {
    // 计算总未实现盈亏
    let totalUnrealizedPnl = 0;
    let totalUsedMargin = 0;

    for (const position of this.positions.values()) {
      if (position.side !== 'none' && position.quantity > 0) {
        totalUnrealizedPnl += position.unrealizedPnl;

        // 重新计算保证金
        const positionValue = position.entryPrice * position.quantity;
        totalUsedMargin += positionValue / position.leverage;
      }
    }

    // 更新账户
    this._account.totalUnrealizedPnl = totalUnrealizedPnl;
    this._account.usedMargin = totalUsedMargin;

    // 计算账户权益
    this._account.equity = this._account.balance + totalUnrealizedPnl;

    // 计算可用余额
    this._account.availableBalance = this._account.balance - totalUsedMargin;
    if (this._account.availableBalance < 0) {
      this._account.availableBalance = 0;
    }

    // 计算保证金率
    this._account.marginRatio = this._account.equity > 0
      ? totalUsedMargin / this._account.equity
      : 0;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建账户管理器
 * @param config - 账户配置
 */
export function createAccountManager(config?: Partial<AccountConfig>): AccountManager {
  return new AccountManager(config);
}
