// ============================================================================
// 策略管理器
// 管理策略的加载、注册、热插拔
// 提供策略生命周期管理
// ============================================================================

import {
  type Strategy,
  type StrategyContext,
  type StrategyAction,
  type BacktestEvent,
  type TradeEvent,
  type DepthEvent,
  type FundingEvent,
  type MarkPriceEvent,
  type KlineEvent,
  type OrderFilledEvent,
  type LiquidationEvent,
} from './types';

// ============================================================================
// 策略管理器配置
// ============================================================================

// 策略管理器配置
export interface StrategyManagerConfig {
  // 是否允许多策略
  allowMultipleStrategies: boolean;
  // 是否捕获策略异常
  catchErrors: boolean;
  // 策略异常处理器
  onError?: (strategyName: string, error: Error) => void;
}

// 默认配置
const DEFAULT_CONFIG: StrategyManagerConfig = {
  // 允许多策略
  allowMultipleStrategies: true,
  // 捕获异常
  catchErrors: true,
};

// ============================================================================
// 策略包装器（内部使用）
// ============================================================================

// 策略包装器
interface StrategyWrapper {
  // 策略实例
  strategy: Strategy;
  // 是否启用
  enabled: boolean;
  // 注册时间
  registeredAt: number;
  // 调用统计
  stats: {
    onTradeCount: number;
    onDepthCount: number;
    onFundingCount: number;
    onMarkPriceCount: number;
    onKlineCount: number;
    onOrderFilledCount: number;
    onLiquidationCount: number;
    errorCount: number;
    totalTime: number;
  };
}

// ============================================================================
// 策略管理器类
// ============================================================================

/**
 * 策略管理器
 * 管理多个策略的注册、调用、热插拔
 */
export class StrategyManager {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: StrategyManagerConfig;

  // 策略映射（策略名称 -> 策略包装器）
  private strategies: Map<string, StrategyWrapper> = new Map();

  // 是否已初始化
  private initialized: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<StrategyManagerConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 策略注册
  // ========================================================================

  /**
   * 注册策略
   * @param strategy - 策略实例
   * @returns 是否成功
   */
  register(strategy: Strategy): boolean {
    // 检查策略名称
    if (!strategy.name) {
      console.error('[StrategyManager] Strategy must have a name');
      return false;
    }

    // 检查是否已注册
    if (this.strategies.has(strategy.name)) {
      console.warn(`[StrategyManager] Strategy "${strategy.name}" already registered, replacing`);
    }

    // 检查是否允许多策略
    if (!this.config.allowMultipleStrategies && this.strategies.size > 0) {
      console.error('[StrategyManager] Multiple strategies not allowed');
      return false;
    }

    // 创建包装器
    const wrapper: StrategyWrapper = {
      strategy,
      enabled: true,
      registeredAt: Date.now(),
      stats: {
        onTradeCount: 0,
        onDepthCount: 0,
        onFundingCount: 0,
        onMarkPriceCount: 0,
        onKlineCount: 0,
        onOrderFilledCount: 0,
        onLiquidationCount: 0,
        errorCount: 0,
        totalTime: 0,
      },
    };

    // 注册策略
    this.strategies.set(strategy.name, wrapper);

    console.log(`[StrategyManager] Registered strategy: ${strategy.name} v${strategy.version}`);
    return true;
  }

  /**
   * 注销策略
   * @param strategyName - 策略名称
   * @returns 是否成功
   */
  unregister(strategyName: string): boolean {
    // 检查是否存在
    const wrapper = this.strategies.get(strategyName);
    if (!wrapper) {
      console.warn(`[StrategyManager] Strategy "${strategyName}" not found`);
      return false;
    }

    // 调用清理回调
    if (wrapper.strategy.onDestroy) {
      try {
        const result = wrapper.strategy.onDestroy();
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(`[StrategyManager] Error in onDestroy for "${strategyName}":`, error);
          });
        }
      } catch (error) {
        console.error(`[StrategyManager] Error in onDestroy for "${strategyName}":`, error);
      }
    }

    // 移除策略
    this.strategies.delete(strategyName);
    console.log(`[StrategyManager] Unregistered strategy: ${strategyName}`);

    return true;
  }

  /**
   * 启用策略
   * @param strategyName - 策略名称
   */
  enable(strategyName: string): boolean {
    const wrapper = this.strategies.get(strategyName);
    if (!wrapper) return false;

    wrapper.enabled = true;
    return true;
  }

  /**
   * 禁用策略
   * @param strategyName - 策略名称
   */
  disable(strategyName: string): boolean {
    const wrapper = this.strategies.get(strategyName);
    if (!wrapper) return false;

    wrapper.enabled = false;
    return true;
  }

  /**
   * 热替换策略
   * @param oldStrategyName - 旧策略名称
   * @param newStrategy - 新策略实例
   */
  hotReplace(oldStrategyName: string, newStrategy: Strategy): boolean {
    // 先注销旧策略
    this.unregister(oldStrategyName);

    // 注册新策略
    return this.register(newStrategy);
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 初始化所有策略
   * @param context - 策略上下文
   */
  async initialize(context: StrategyContext): Promise<void> {
    // 遍历所有策略
    for (const [name, wrapper] of this.strategies) {
      // 跳过禁用的策略
      if (!wrapper.enabled) continue;

      // 调用初始化回调
      if (wrapper.strategy.onInit) {
        try {
          await wrapper.strategy.onInit(context);
          console.log(`[StrategyManager] Initialized strategy: ${name}`);
        } catch (error) {
          console.error(`[StrategyManager] Error initializing strategy "${name}":`, error);
          wrapper.stats.errorCount++;

          // 调用错误处理器
          if (this.config.onError) {
            this.config.onError(name, error as Error);
          }
        }
      }
    }

    this.initialized = true;
  }

  /**
   * 清理所有策略
   */
  async destroy(): Promise<void> {
    // 遍历所有策略
    for (const [name, wrapper] of this.strategies) {
      // 调用清理回调
      if (wrapper.strategy.onDestroy) {
        try {
          await wrapper.strategy.onDestroy();
        } catch (error) {
          console.error(`[StrategyManager] Error destroying strategy "${name}":`, error);
        }
      }
    }

    // 清空策略
    this.strategies.clear();
    this.initialized = false;
  }

  // ========================================================================
  // 公共方法 - 事件分发
  // ========================================================================

  /**
   * 分发事件到所有策略
   * @param event - 事件
   * @param context - 策略上下文
   * @returns 合并后的策略动作
   */
  dispatchEvent(event: BacktestEvent, context: StrategyContext): StrategyAction {
    // 合并的动作
    const mergedAction: StrategyAction = {
      orders: [],
      cancelOrders: [],
      modifyOrders: [],
    };

    // 根据事件类型分发
    switch (event.type) {
      case 'trade':
        this.dispatchTrade(event, context, mergedAction);
        break;

      case 'depth':
        this.dispatchDepth(event, context, mergedAction);
        break;

      case 'funding':
        this.dispatchFunding(event, context, mergedAction);
        break;

      case 'markPrice':
        this.dispatchMarkPrice(event, context, mergedAction);
        break;

      case 'kline':
        this.dispatchKline(event, context, mergedAction);
        break;

      case 'orderFilled':
        this.dispatchOrderFilled(event, context, mergedAction);
        break;

      case 'liquidation':
        this.dispatchLiquidation(event, context);
        break;
    }

    return mergedAction;
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取所有策略名称
   */
  getStrategyNames(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * 获取策略
   * @param name - 策略名称
   */
  getStrategy(name: string): Strategy | undefined {
    return this.strategies.get(name)?.strategy;
  }

  /**
   * 获取策略统计
   * @param name - 策略名称
   */
  getStrategyStats(name: string) {
    return this.strategies.get(name)?.stats;
  }

  /**
   * 获取所有策略统计
   */
  getAllStats() {
    const result: Record<string, StrategyWrapper['stats']> = {};

    for (const [name, wrapper] of this.strategies) {
      result[name] = { ...wrapper.stats };
    }

    return result;
  }

  /**
   * 获取策略数量
   */
  get count(): number {
    return this.strategies.size;
  }

  /**
   * 检查是否已初始化
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  // ========================================================================
  // 私有方法 - 事件分发
  // ========================================================================

  /**
   * 分发成交事件
   */
  private dispatchTrade(
    event: TradeEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      // 跳过禁用的策略
      if (!wrapper.enabled) continue;

      // 检查回调是否存在
      if (!wrapper.strategy.onTrade) continue;

      // 调用回调
      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onTrade!(event, context),
        mergedAction,
        'onTradeCount'
      );
    }
  }

  /**
   * 分发深度事件
   */
  private dispatchDepth(
    event: DepthEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onDepth) continue;

      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onDepth!(event, context),
        mergedAction,
        'onDepthCount'
      );
    }
  }

  /**
   * 分发资金费率事件
   */
  private dispatchFunding(
    event: FundingEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onFunding) continue;

      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onFunding!(event, context),
        mergedAction,
        'onFundingCount'
      );
    }
  }

  /**
   * 分发标记价格事件
   */
  private dispatchMarkPrice(
    event: MarkPriceEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onMarkPrice) continue;

      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onMarkPrice!(event, context),
        mergedAction,
        'onMarkPriceCount'
      );
    }
  }

  /**
   * 分发 K线事件
   */
  private dispatchKline(
    event: KlineEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onKline) continue;

      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onKline!(event, context),
        mergedAction,
        'onKlineCount'
      );
    }
  }

  /**
   * 分发订单成交事件
   */
  private dispatchOrderFilled(
    event: OrderFilledEvent,
    context: StrategyContext,
    mergedAction: StrategyAction
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onOrderFilled) continue;

      this.invokeCallback(
        name,
        wrapper,
        () => wrapper.strategy.onOrderFilled!(event, context),
        mergedAction,
        'onOrderFilledCount'
      );
    }
  }

  /**
   * 分发强平事件
   */
  private dispatchLiquidation(
    event: LiquidationEvent,
    context: StrategyContext
  ): void {
    for (const [name, wrapper] of this.strategies) {
      if (!wrapper.enabled) continue;
      if (!wrapper.strategy.onLiquidation) continue;

      // 强平事件不返回动作
      const startTime = Date.now();

      try {
        wrapper.strategy.onLiquidation(event, context);
        wrapper.stats.onLiquidationCount++;
        wrapper.stats.totalTime += Date.now() - startTime;
      } catch (error) {
        wrapper.stats.errorCount++;

        if (this.config.catchErrors) {
          console.error(`[StrategyManager] Error in onLiquidation for "${name}":`, error);
          if (this.config.onError) {
            this.config.onError(name, error as Error);
          }
        } else {
          throw error;
        }
      }
    }
  }

  // ========================================================================
  // 私有方法 - 回调调用
  // ========================================================================

  /**
   * 调用策略回调并合并动作
   */
  private invokeCallback(
    name: string,
    wrapper: StrategyWrapper,
    callback: () => StrategyAction | void,
    mergedAction: StrategyAction,
    countKey: keyof StrategyWrapper['stats']
  ): void {
    // 记录开始时间
    const startTime = Date.now();

    try {
      // 调用回调
      const action = callback();

      // 更新统计
      (wrapper.stats[countKey] as number)++;
      wrapper.stats.totalTime += Date.now() - startTime;

      // 合并动作
      if (action) {
        this.mergeAction(mergedAction, action);
      }

    } catch (error) {
      // 更新错误统计
      wrapper.stats.errorCount++;

      // 处理错误
      if (this.config.catchErrors) {
        console.error(`[StrategyManager] Error in callback for "${name}":`, error);
        if (this.config.onError) {
          this.config.onError(name, error as Error);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * 合并策略动作
   */
  private mergeAction(target: StrategyAction, source: StrategyAction): void {
    // 合并订单
    if (source.orders) {
      target.orders = target.orders ?? [];
      target.orders.push(...source.orders);
    }

    // 合并取消订单
    if (source.cancelOrders) {
      target.cancelOrders = target.cancelOrders ?? [];
      target.cancelOrders.push(...source.cancelOrders);
    }

    // 合并修改订单
    if (source.modifyOrders) {
      target.modifyOrders = target.modifyOrders ?? [];
      target.modifyOrders.push(...source.modifyOrders);
    }
  }
}

// ============================================================================
// 策略基类（可选继承）
// ============================================================================

/**
 * 策略基类
 * 提供策略的基础实现，子类可以只覆盖需要的方法
 */
export abstract class BaseStrategy implements Strategy {
  // 策略名称（必须覆盖）
  abstract readonly name: string;

  // 策略版本
  readonly version: string = '1.0.0';

  // 策略描述
  readonly description?: string;

  // 初始化
  onInit?(context: StrategyContext): void | Promise<void>;

  // 成交回调（子类可覆盖）
  onTrade?(event: TradeEvent, context: StrategyContext): StrategyAction | void;

  // 深度回调（子类可覆盖）
  onDepth?(event: DepthEvent, context: StrategyContext): StrategyAction | void;

  // 资金费率回调（子类可覆盖）
  onFunding?(event: FundingEvent, context: StrategyContext): StrategyAction | void;

  // 标记价格回调（子类可覆盖）
  onMarkPrice?(event: MarkPriceEvent, context: StrategyContext): StrategyAction | void;

  // K线回调（子类可覆盖）
  onKline?(event: KlineEvent, context: StrategyContext): StrategyAction | void;

  // 订单成交回调（子类可覆盖）
  onOrderFilled?(event: OrderFilledEvent, context: StrategyContext): StrategyAction | void;

  // 强平回调（子类可覆盖）
  onLiquidation?(event: LiquidationEvent, context: StrategyContext): void;

  // 清理
  onDestroy?(): void | Promise<void>;
}

// ============================================================================
// 示例策略
// ============================================================================

/**
 * 示例策略：简单的网格交易
 * 仅用于演示策略结构，不用于实际交易
 */
export class ExampleGridStrategy extends BaseStrategy {
  // 策略名称
  readonly name = 'example-grid';

  // 策略版本
  readonly version = '1.0.0';

  // 策略描述
  readonly description = '示例网格交易策略';

  // 网格参数
  private gridSize = 10;      // 网格数量
  private gridSpacing = 0.01; // 网格间距（1%）
  private orderQuantity = 0.001; // 每格订单数量

  // 中心价格
  private centerPrice = 0;

  // 初始化
  onInit(context: StrategyContext): void {
    console.log(`[${this.name}] Strategy initialized`);
  }

  // 深度更新时检查是否需要下单
  onDepth(event: DepthEvent, context: StrategyContext): StrategyAction | void {
    // 获取中间价
    const midPrice = (event.bids[0]?.price ?? 0 + (event.asks[0]?.price ?? 0)) / 2;

    // 如果还没有设置中心价格，使用当前中间价
    if (this.centerPrice === 0) {
      this.centerPrice = midPrice;
    }

    // 检查是否有活跃订单
    if (context.activeOrders.size > 0) {
      // 已有订单，不重复下单
      return;
    }

    // 生成网格订单
    const orders = [];

    // 买单（低于中心价格）
    for (let i = 1; i <= this.gridSize / 2; i++) {
      const price = this.centerPrice * (1 - this.gridSpacing * i);
      orders.push({
        exchange: event.exchange,
        symbol: event.symbol,
        side: 'buy' as const,
        type: 'limit' as const,
        quantity: this.orderQuantity,
        price,
        postOnly: true,
      });
    }

    // 卖单（高于中心价格）
    for (let i = 1; i <= this.gridSize / 2; i++) {
      const price = this.centerPrice * (1 + this.gridSpacing * i);
      orders.push({
        exchange: event.exchange,
        symbol: event.symbol,
        side: 'sell' as const,
        type: 'limit' as const,
        quantity: this.orderQuantity,
        price,
        postOnly: true,
      });
    }

    return { orders };
  }

  // 订单成交时更新中心价格
  onOrderFilled(event: OrderFilledEvent, context: StrategyContext): void {
    console.log(`[${this.name}] Order filled at ${event.fillPrice}`);
    // 成交后可以调整中心价格或重新布网格
  }

  // 清理
  onDestroy(): void {
    console.log(`[${this.name}] Strategy destroyed`);
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建策略管理器
 * @param config - 配置
 */
export function createStrategyManager(
  config?: Partial<StrategyManagerConfig>
): StrategyManager {
  return new StrategyManager(config);
}
