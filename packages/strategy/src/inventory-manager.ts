// ============================================================================
// 库存管理器
// 跟踪各交易所持仓，计算库存偏离度，生成再平衡操作
// 核心功能：多交易所持仓同步、净敞口计算、自动再平衡
// ============================================================================

import {
  type ExchangeId,
  type PositionSide,
  type Timestamp,
  type ExchangeInventory,
  type TotalInventory,
  type RebalanceAction,
  SUPPORTED_EXCHANGES,
} from './types';

// ============================================================================
// 配置接口
// ============================================================================

// 库存管理配置
interface InventoryConfig {
  // 再平衡阈值（库存偏离度超过此值触发）
  rebalanceThreshold: number;
  // 最大库存占比（超过此值停止开仓）
  maxInventoryRatio: number;
  // 最小再平衡数量（低于此值不执行）
  minRebalanceSize: number;
  // 最大单次再平衡比例（占总持仓）
  maxRebalanceRatio: number;
  // 再平衡冷却时间（毫秒）
  rebalanceCooldown: number;
}

// 默认库存管理配置
const DEFAULT_INVENTORY_CONFIG: InventoryConfig = {
  // 库存偏离 > 20% 触发再平衡
  rebalanceThreshold: 0.20,
  // 库存占比 > 30% 停止开仓
  maxInventoryRatio: 0.30,
  // 最小再平衡 100 USDT
  minRebalanceSize: 100,
  // 单次最多再平衡总持仓的 50%
  maxRebalanceRatio: 0.50,
  // 再平衡冷却 5 分钟
  rebalanceCooldown: 5 * 60 * 1000,
};

// ============================================================================
// 库存管理器类
// ============================================================================

/**
 * 库存管理器
 * 负责跟踪各交易所持仓，计算库存状态，生成再平衡操作
 */
export class InventoryManager {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: InventoryConfig;

  // 各交易所库存（exchange:symbol -> inventory）
  private inventories: Map<string, ExchangeInventory> = new Map();

  // 总库存缓存（symbol -> total inventory）
  private totalInventories: Map<string, TotalInventory> = new Map();

  // 上次再平衡时间（symbol -> timestamp）
  private lastRebalanceTime: Map<string, Timestamp> = new Map();

  // 权益（用于计算比例）
  private equity: number = 0;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 库存管理配置（可选）
   */
  constructor(config?: Partial<InventoryConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_INVENTORY_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 权益设置
  // ========================================================================

  /**
   * 设置当前权益
   * @param equity - 账户权益
   */
  setEquity(equity: number): void {
    this.equity = equity;
  }

  /**
   * 获取当前权益
   */
  getEquity(): number {
    return this.equity;
  }

  // ========================================================================
  // 公共方法 - 库存更新
  // ========================================================================

  /**
   * 更新单个交易所的库存
   * @param inventory - 库存数据
   */
  updateInventory(inventory: ExchangeInventory): void {
    // 生成缓存键
    const key = this.getKey(inventory.exchange, inventory.symbol);

    // 更新库存
    this.inventories.set(key, {
      ...inventory,
      updatedAt: Date.now(),
    });

    // 重新计算总库存
    this.recalculateTotalInventory(inventory.symbol);
  }

  /**
   * 批量更新库存
   * @param inventories - 库存数据数组
   */
  updateInventories(inventories: ExchangeInventory[]): void {
    // 收集需要更新的交易对
    const symbolsToUpdate = new Set<string>();

    // 更新每个库存
    for (const inventory of inventories) {
      const key = this.getKey(inventory.exchange, inventory.symbol);
      this.inventories.set(key, {
        ...inventory,
        updatedAt: Date.now(),
      });
      symbolsToUpdate.add(inventory.symbol);
    }

    // 重新计算受影响的总库存
    for (const symbol of symbolsToUpdate) {
      this.recalculateTotalInventory(symbol);
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
    // 生成缓存键
    const key = this.getKey(exchange, symbol);

    // 获取现有库存或创建新的
    const existing = this.inventories.get(key);

    // 计算持仓价值
    const notionalValue = quantity * entryPrice;

    // 计算保证金
    const margin = notionalValue / leverage;

    // 创建/更新库存
    const inventory: ExchangeInventory = {
      exchange,
      symbol,
      side,
      quantity,
      notionalValue,
      entryPrice,
      unrealizedPnl: existing?.unrealizedPnl ?? 0,
      realizedPnl: existing?.realizedPnl ?? 0,
      fundingPaid: existing?.fundingPaid ?? 0,
      fundingReceived: existing?.fundingReceived ?? 0,
      netFunding: existing?.netFunding ?? 0,
      leverage,
      margin,
      updatedAt: Date.now(),
    };

    // 保存库存
    this.inventories.set(key, inventory);

    // 重新计算总库存
    this.recalculateTotalInventory(symbol);
  }

  /**
   * 更新未实现盈亏
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param currentPrice - 当前价格
   */
  updateUnrealizedPnl(
    exchange: ExchangeId,
    symbol: string,
    currentPrice: number
  ): void {
    // 获取库存
    const key = this.getKey(exchange, symbol);
    const inventory = this.inventories.get(key);

    // 如果不存在，跳过
    if (!inventory || inventory.side === 'none') {
      return;
    }

    // 计算未实现盈亏
    const priceDiff = currentPrice - inventory.entryPrice;
    const direction = inventory.side === 'long' ? 1 : -1;
    const unrealizedPnl = priceDiff * inventory.quantity * direction;

    // 更新库存
    this.inventories.set(key, {
      ...inventory,
      unrealizedPnl,
      updatedAt: Date.now(),
    });
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
    // 获取库存
    const key = this.getKey(exchange, symbol);
    const inventory = this.inventories.get(key);

    // 如果不存在，跳过
    if (!inventory) {
      return;
    }

    // 更新资金费用
    let fundingPaid = inventory.fundingPaid;
    let fundingReceived = inventory.fundingReceived;

    if (fundingFee > 0) {
      // 支付资金费
      fundingPaid += fundingFee;
    } else {
      // 收取资金费
      fundingReceived += Math.abs(fundingFee);
    }

    // 计算净资金费
    const netFunding = fundingPaid - fundingReceived;

    // 更新库存
    this.inventories.set(key, {
      ...inventory,
      fundingPaid,
      fundingReceived,
      netFunding,
      updatedAt: Date.now(),
    });
  }

  /**
   * 记录已实现盈亏
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param realizedPnl - 已实现盈亏
   */
  recordRealizedPnl(
    exchange: ExchangeId,
    symbol: string,
    realizedPnl: number
  ): void {
    // 获取库存
    const key = this.getKey(exchange, symbol);
    const inventory = this.inventories.get(key);

    // 如果不存在，跳过
    if (!inventory) {
      return;
    }

    // 更新已实现盈亏
    this.inventories.set(key, {
      ...inventory,
      realizedPnl: inventory.realizedPnl + realizedPnl,
      updatedAt: Date.now(),
    });
  }

  // ========================================================================
  // 公共方法 - 库存查询
  // ========================================================================

  /**
   * 获取单个交易所的库存
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getInventory(exchange: ExchangeId, symbol: string): ExchangeInventory | undefined {
    const key = this.getKey(exchange, symbol);
    return this.inventories.get(key);
  }

  /**
   * 获取总库存
   * @param symbol - 交易对
   */
  getTotalInventory(symbol: string): TotalInventory | undefined {
    return this.totalInventories.get(symbol);
  }

  /**
   * 获取所有交易所的库存
   * @param symbol - 交易对
   */
  getAllInventories(symbol: string): Map<ExchangeId, ExchangeInventory> {
    // 结果映射
    const result = new Map<ExchangeId, ExchangeInventory>();

    // 遍历所有交易所
    for (const exchange of SUPPORTED_EXCHANGES) {
      const inventory = this.getInventory(exchange, symbol);
      if (inventory) {
        result.set(exchange, inventory);
      }
    }

    return result;
  }

  /**
   * 获取净持仓
   * @param symbol - 交易对
   */
  getNetPosition(symbol: string): number {
    const total = this.getTotalInventory(symbol);
    return total?.netPosition ?? 0;
  }

  /**
   * 获取库存偏离度
   * @param symbol - 交易对
   */
  getImbalanceRatio(symbol: string): number {
    const total = this.getTotalInventory(symbol);
    return total?.imbalanceRatio ?? 0;
  }

  /**
   * 检查是否需要再平衡
   * @param symbol - 交易对
   */
  needsRebalance(symbol: string): boolean {
    // 获取总库存
    const total = this.getTotalInventory(symbol);

    // 如果没有库存，不需要再平衡
    if (!total) {
      return false;
    }

    // 检查冷却时间
    const lastTime = this.lastRebalanceTime.get(symbol) ?? 0;
    if (Date.now() - lastTime < this.config.rebalanceCooldown) {
      return false;
    }

    // 检查偏离度
    return total.imbalanceRatio > this.config.rebalanceThreshold;
  }

  /**
   * 检查是否可以开仓
   * @param symbol - 交易对
   */
  canOpenPosition(symbol: string): boolean {
    // 如果没有设置权益，允许开仓
    if (this.equity <= 0) {
      return true;
    }

    // 获取总库存
    const total = this.getTotalInventory(symbol);

    // 如果没有库存，允许开仓
    if (!total) {
      return true;
    }

    // 计算库存占比
    const inventoryRatio = total.totalNotional / this.equity;

    // 检查是否超过最大库存占比
    return inventoryRatio < this.config.maxInventoryRatio;
  }

  /**
   * 获取可用开仓额度
   * @param symbol - 交易对
   */
  getAvailableCapacity(symbol: string): number {
    // 如果没有设置权益，返回 0
    if (this.equity <= 0) {
      return 0;
    }

    // 获取总库存
    const total = this.getTotalInventory(symbol);
    const currentNotional = total?.totalNotional ?? 0;

    // 计算最大允许持仓
    const maxNotional = this.equity * this.config.maxInventoryRatio;

    // 返回剩余额度
    return Math.max(0, maxNotional - currentNotional);
  }

  // ========================================================================
  // 公共方法 - 再平衡
  // ========================================================================

  /**
   * 生成再平衡操作
   * @param symbol - 交易对
   */
  generateRebalanceActions(symbol: string): RebalanceAction[] {
    // 结果数组
    const actions: RebalanceAction[] = [];

    // 获取总库存
    const total = this.getTotalInventory(symbol);

    // 如果没有库存或不需要再平衡，返回空
    if (!total || !this.needsRebalance(symbol)) {
      return actions;
    }

    // 获取净持仓
    const netPosition = total.netPosition;

    // 如果净持仓为 0，不需要再平衡
    if (Math.abs(netPosition) < 0.0001) {
      return actions;
    }

    // 确定再平衡方向
    // 如果净持仓为正（多头过多），需要减少多头或增加空头
    // 如果净持仓为负（空头过多），需要减少空头或增加多头
    const targetReduction = Math.abs(netPosition) / 2; // 目标减少一半不平衡

    // 限制单次再平衡量
    const maxRebalanceQty = total.totalNotional * this.config.maxRebalanceRatio /
      (total.exchanges.values().next().value?.entryPrice ?? 1);
    const rebalanceQty = Math.min(targetReduction, maxRebalanceQty);

    // 检查最小再平衡数量
    const rebalanceNotional = rebalanceQty *
      (total.exchanges.values().next().value?.entryPrice ?? 0);
    if (rebalanceNotional < this.config.minRebalanceSize) {
      return actions;
    }

    // 遍历所有交易所，寻找可以减仓的
    for (const [exchange, inventory] of total.exchanges) {
      // 跳过无持仓的交易所
      if (inventory.side === 'none' || inventory.quantity <= 0) {
        continue;
      }

      // 检查是否是需要减少的方向
      const isLong = inventory.side === 'long';
      const shouldReduce = (netPosition > 0 && isLong) || (netPosition < 0 && !isLong);

      if (shouldReduce) {
        // 计算该交易所可以减少的数量
        const reduceQty = Math.min(rebalanceQty, inventory.quantity);

        // 创建减仓操作
        actions.push({
          type: 'reduce',
          exchange,
          symbol,
          side: isLong ? 'sell' : 'buy', // 减仓方向与持仓相反
          quantity: reduceQty,
          reason: `再平衡：净持仓 ${netPosition.toFixed(4)}，偏离度 ${(total.imbalanceRatio * 100).toFixed(1)}%`,
          priority: 8, // 高优先级
        });

        // 只生成一个操作
        break;
      }
    }

    return actions;
  }

  /**
   * 记录再平衡完成
   * @param symbol - 交易对
   */
  recordRebalance(symbol: string): void {
    this.lastRebalanceTime.set(symbol, Date.now());
  }

  // ========================================================================
  // 公共方法 - 统计
  // ========================================================================

  /**
   * 获取总持仓价值
   * @param symbol - 交易对（可选，不传则计算所有）
   */
  getTotalNotional(symbol?: string): number {
    // 如果指定了交易对
    if (symbol) {
      const total = this.getTotalInventory(symbol);
      return total?.totalNotional ?? 0;
    }

    // 计算所有交易对
    let totalNotional = 0;
    for (const total of this.totalInventories.values()) {
      totalNotional += total.totalNotional;
    }
    return totalNotional;
  }

  /**
   * 获取总未实现盈亏
   */
  getTotalUnrealizedPnl(): number {
    let total = 0;
    for (const inventory of this.inventories.values()) {
      total += inventory.unrealizedPnl;
    }
    return total;
  }

  /**
   * 获取总已实现盈亏
   */
  getTotalRealizedPnl(): number {
    let total = 0;
    for (const inventory of this.inventories.values()) {
      total += inventory.realizedPnl;
    }
    return total;
  }

  /**
   * 获取总净资金费用
   */
  getTotalNetFunding(): number {
    let total = 0;
    for (const inventory of this.inventories.values()) {
      total += inventory.netFunding;
    }
    return total;
  }

  /**
   * 获取库存摘要
   * @param symbol - 交易对
   */
  getInventorySummary(symbol: string): {
    exchanges: { exchange: ExchangeId; side: PositionSide; quantity: number; notional: number }[];
    netPosition: number;
    totalNotional: number;
    imbalanceRatio: number;
    canOpen: boolean;
    needsRebalance: boolean;
  } {
    // 获取总库存
    const total = this.getTotalInventory(symbol);

    // 构建交易所数组
    const exchanges: { exchange: ExchangeId; side: PositionSide; quantity: number; notional: number }[] = [];

    if (total) {
      for (const [exchange, inventory] of total.exchanges) {
        exchanges.push({
          exchange,
          side: inventory.side,
          quantity: inventory.quantity,
          notional: inventory.notionalValue,
        });
      }
    }

    return {
      exchanges,
      netPosition: total?.netPosition ?? 0,
      totalNotional: total?.totalNotional ?? 0,
      imbalanceRatio: total?.imbalanceRatio ?? 0,
      canOpen: this.canOpenPosition(symbol),
      needsRebalance: this.needsRebalance(symbol),
    };
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有库存
   */
  clear(): void {
    this.inventories.clear();
    this.totalInventories.clear();
    this.lastRebalanceTime.clear();
  }

  /**
   * 清空指定交易对的库存
   * @param symbol - 交易对
   */
  clearSymbol(symbol: string): void {
    // 删除各交易所库存
    for (const exchange of SUPPORTED_EXCHANGES) {
      const key = this.getKey(exchange, symbol);
      this.inventories.delete(key);
    }

    // 删除总库存
    this.totalInventories.delete(symbol);

    // 删除再平衡时间
    this.lastRebalanceTime.delete(symbol);
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 重新计算总库存
   * @param symbol - 交易对
   */
  private recalculateTotalInventory(symbol: string): void {
    // 收集各交易所库存
    const exchanges = new Map<ExchangeId, ExchangeInventory>();
    let netPosition = 0;
    let totalNotional = 0;

    // 遍历所有交易所
    for (const exchange of SUPPORTED_EXCHANGES) {
      const inventory = this.getInventory(exchange, symbol);
      if (inventory) {
        exchanges.set(exchange, inventory);

        // 计算净持仓（多头为正，空头为负）
        const direction = inventory.side === 'long' ? 1 : (inventory.side === 'short' ? -1 : 0);
        netPosition += inventory.quantity * direction;

        // 累计总持仓价值
        totalNotional += inventory.notionalValue;
      }
    }

    // 如果没有任何库存，删除总库存
    if (exchanges.size === 0) {
      this.totalInventories.delete(symbol);
      return;
    }

    // 计算库存偏离度
    // 公式：|净持仓| / 总持仓
    // 完美对冲时为 0，完全单向时为 1
    const totalQuantity = Array.from(exchanges.values())
      .reduce((sum, inv) => sum + inv.quantity, 0);
    const imbalanceRatio = totalQuantity > 0 ? Math.abs(netPosition) / totalQuantity : 0;

    // 判断是否需要再平衡
    const needsRebalance = imbalanceRatio > this.config.rebalanceThreshold;

    // 创建总库存
    const totalInventory: TotalInventory = {
      symbol,
      exchanges,
      netPosition,
      totalNotional,
      imbalanceRatio,
      needsRebalance,
      updatedAt: Date.now(),
    };

    // 保存总库存
    this.totalInventories.set(symbol, totalInventory);
  }

  /**
   * 生成缓存键
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  private getKey(exchange: ExchangeId, symbol: string): string {
    return `${exchange}:${symbol}`;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建库存管理器
 * @param config - 配置（可选）
 */
export function createInventoryManager(
  config?: Partial<InventoryConfig>
): InventoryManager {
  return new InventoryManager(config);
}

// 导出默认配置
export { DEFAULT_INVENTORY_CONFIG };
export type { InventoryConfig };
