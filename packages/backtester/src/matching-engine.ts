// ============================================================================
// 订单撮合引擎
// 模拟交易所订单撮合逻辑
// 支持限价单、市价单、Post-Only、Reduce-Only
// ============================================================================

import {
  type ExchangeId,
  type OrderSide,
  type OrderType,
  type OrderStatus,
  type Order,
  type OrderRequest,
  type TradeEvent,
  type DepthEvent,
  type OrderFilledEvent,
  type FeeConfig,
  type Timestamp,
  DEFAULT_FEE_CONFIG,
  generateId,
  getPositionKey,
} from './types';

import { OrderBookManager } from './order-book';

// ============================================================================
// 撮合结果类型
// ============================================================================

// 订单撮合结果
export interface MatchResult {
  // 是否成功
  success: boolean;
  // 订单对象（成功时返回）
  order?: Order;
  // 成交事件列表
  fills: OrderFilledEvent[];
  // 错误消息（失败时返回）
  error?: string;
  // 拒绝原因（订单被拒绝时返回）
  rejectReason?: string;
}

// 订单修改请求
export interface ModifyOrderRequest {
  // 订单 ID
  orderId: string;
  // 新价格（可选）
  newPrice?: number;
  // 新数量（可选）
  newQuantity?: number;
}

// ============================================================================
// 撮合引擎配置
// ============================================================================

// 撮合引擎配置
export interface MatchingEngineConfig {
  // 手续费配置（按交易所）
  feeConfig?: Partial<Record<ExchangeId, FeeConfig>>;
  // 是否启用 Post-Only 检查
  enablePostOnly?: boolean;
  // 是否启用 Reduce-Only 检查
  enableReduceOnly?: boolean;
  // 最小订单数量
  minOrderQuantity?: number;
  // 最大订单数量
  maxOrderQuantity?: number;
}

// 默认配置
const DEFAULT_CONFIG: Required<MatchingEngineConfig> = {
  feeConfig: {},
  enablePostOnly: true,
  enableReduceOnly: true,
  minOrderQuantity: 0.001,
  maxOrderQuantity: 1000000,
};

// ============================================================================
// 撮合引擎类
// ============================================================================

/**
 * 订单撮合引擎
 * 模拟交易所的订单撮合逻辑
 */
export class MatchingEngine {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: Required<MatchingEngineConfig>;

  // 订单簿管理器
  private orderBookManager: OrderBookManager;

  // 活跃订单映射（订单 ID -> 订单）
  private activeOrders: Map<string, Order> = new Map();

  // 客户端订单 ID 映射（clientOrderId -> orderId）
  private clientOrderIdMap: Map<string, string> = new Map();

  // 当前时间戳
  private currentTimestamp: Timestamp = 0;

  // 持仓查询函数（用于 Reduce-Only 检查）
  private getPosition: (exchange: ExchangeId, symbol: string) => { side: string; quantity: number } | undefined;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param orderBookManager - 订单簿管理器
   * @param getPosition - 持仓查询函数
   * @param config - 配置
   */
  constructor(
    orderBookManager: OrderBookManager,
    getPosition: (exchange: ExchangeId, symbol: string) => { side: string; quantity: number } | undefined,
    config?: MatchingEngineConfig
  ) {
    // 保存订单簿管理器
    this.orderBookManager = orderBookManager;

    // 保存持仓查询函数
    this.getPosition = getPosition;

    // 合并配置
    this.config = { ...DEFAULT_CONFIG, ...config };
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
  // 公共方法 - 订单提交
  // ========================================================================

  /**
   * 提交订单
   * @param request - 订单请求
   * @returns 撮合结果
   */
  submitOrder(request: OrderRequest): MatchResult {
    // 验证订单参数
    const validationError = this.validateOrder(request);
    if (validationError) {
      return {
        success: false,
        fills: [],
        error: validationError,
      };
    }

    // 创建订单对象
    const order = this.createOrder(request);

    // 根据订单类型处理
    if (request.type === 'market') {
      // 市价单立即撮合
      return this.matchMarketOrder(order);
    } else {
      // 限价单处理
      return this.matchLimitOrder(order);
    }
  }

  /**
   * 批量提交订单
   * @param requests - 订单请求列表
   * @returns 撮合结果列表
   */
  submitOrders(requests: OrderRequest[]): MatchResult[] {
    // 逐个提交
    return requests.map((request) => this.submitOrder(request));
  }

  // ========================================================================
  // 公共方法 - 订单取消
  // ========================================================================

  /**
   * 取消订单
   * @param orderId - 订单 ID
   * @returns 是否成功
   */
  cancelOrder(orderId: string): boolean {
    // 查找订单
    const order = this.activeOrders.get(orderId);

    // 订单不存在
    if (!order) {
      return false;
    }

    // 订单已完成，不能取消
    if (order.status === 'filled' || order.status === 'cancelled') {
      return false;
    }

    // 更新订单状态
    order.status = 'cancelled';
    order.updatedAt = this.currentTimestamp;

    // 从活跃订单中移除
    this.activeOrders.delete(orderId);

    // 移除客户端 ID 映射
    if (order.clientOrderId) {
      this.clientOrderIdMap.delete(order.clientOrderId);
    }

    return true;
  }

  /**
   * 批量取消订单
   * @param orderIds - 订单 ID 列表
   * @returns 成功取消的订单 ID 列表
   */
  cancelOrders(orderIds: string[]): string[] {
    // 过滤成功取消的订单
    return orderIds.filter((orderId) => this.cancelOrder(orderId));
  }

  /**
   * 取消指定交易对的所有订单
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @returns 取消的订单数量
   */
  cancelAllOrders(exchange: ExchangeId, symbol: string): number {
    // 找到所有匹配的订单
    const ordersToCancel: string[] = [];

    for (const [orderId, order] of this.activeOrders) {
      if (order.exchange === exchange && order.symbol === symbol) {
        ordersToCancel.push(orderId);
      }
    }

    // 批量取消
    const cancelled = this.cancelOrders(ordersToCancel);
    return cancelled.length;
  }

  // ========================================================================
  // 公共方法 - 订单修改
  // ========================================================================

  /**
   * 修改订单
   * @param request - 修改请求
   * @returns 是否成功
   */
  modifyOrder(request: ModifyOrderRequest): boolean {
    // 查找订单
    const order = this.activeOrders.get(request.orderId);

    // 订单不存在
    if (!order) {
      return false;
    }

    // 只能修改待处理或部分成交的限价单
    if (order.status !== 'pending' && order.status !== 'partial') {
      return false;
    }

    if (order.type !== 'limit') {
      return false;
    }

    // 修改价格
    if (request.newPrice !== undefined) {
      // 类型断言：限价单一定有 price 字段
      (order as { price: number }).price = request.newPrice;
    }

    // 修改数量（只能减少未成交部分）
    if (request.newQuantity !== undefined) {
      const unfilledQuantity = order.quantity - order.filledQuantity;
      if (request.newQuantity < order.filledQuantity) {
        // 新数量不能小于已成交数量
        return false;
      }
      // 更新订单数量（需要类型断言绕过 readonly）
      (order as { quantity: number }).quantity = request.newQuantity;
    }

    // 更新时间
    order.updatedAt = this.currentTimestamp;

    return true;
  }

  // ========================================================================
  // 公共方法 - 订单查询
  // ========================================================================

  /**
   * 获取订单
   * @param orderId - 订单 ID
   */
  getOrder(orderId: string): Order | undefined {
    return this.activeOrders.get(orderId);
  }

  /**
   * 通过客户端订单 ID 获取订单
   * @param clientOrderId - 客户端订单 ID
   */
  getOrderByClientId(clientOrderId: string): Order | undefined {
    const orderId = this.clientOrderIdMap.get(clientOrderId);
    if (!orderId) return undefined;
    return this.activeOrders.get(orderId);
  }

  /**
   * 获取所有活跃订单
   */
  getAllActiveOrders(): Order[] {
    return Array.from(this.activeOrders.values());
  }

  /**
   * 获取指定交易对的活跃订单
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getActiveOrders(exchange: ExchangeId, symbol: string): Order[] {
    const orders: Order[] = [];

    for (const order of this.activeOrders.values()) {
      if (order.exchange === exchange && order.symbol === symbol) {
        orders.push(order);
      }
    }

    return orders;
  }

  /**
   * 获取活跃订单映射（只读）
   */
  getActiveOrdersMap(): ReadonlyMap<string, Readonly<Order>> {
    return this.activeOrders;
  }

  // ========================================================================
  // 公共方法 - 事件处理
  // ========================================================================

  /**
   * 处理成交事件（检查限价单是否可以成交）
   * @param trade - 成交事件
   * @returns 触发的成交事件列表
   */
  onTrade(trade: TradeEvent): OrderFilledEvent[] {
    // 更新时间戳
    this.currentTimestamp = trade.timestamp;

    // 收集触发的成交事件
    const fills: OrderFilledEvent[] = [];

    // 检查所有活跃限价单
    for (const order of this.activeOrders.values()) {
      // 只检查匹配的交易对
      if (order.exchange !== trade.exchange || order.symbol !== trade.symbol) {
        continue;
      }

      // 只检查限价单
      if (order.type !== 'limit') {
        continue;
      }

      // 只检查待处理或部分成交的订单
      if (order.status !== 'pending' && order.status !== 'partial') {
        continue;
      }

      // 检查价格是否触发
      const triggered = this.checkLimitOrderTriggered(order, trade.price);

      if (triggered) {
        // 计算成交数量
        const remainingQuantity = order.quantity - order.filledQuantity;

        // 生成成交事件
        const fillEvent = this.createFillEvent(
          order,
          order.price!, // 限价单一定有价格
          remainingQuantity,
          true // Maker 成交
        );

        // 更新订单状态
        this.updateOrderAfterFill(order, remainingQuantity, order.price!);

        fills.push(fillEvent);
      }
    }

    return fills;
  }

  /**
   * 处理深度更新（检查限价单是否可以成交）
   * @param depth - 深度事件
   * @returns 触发的成交事件列表
   */
  onDepth(depth: DepthEvent): OrderFilledEvent[] {
    // 更新时间戳
    this.currentTimestamp = depth.timestamp;

    // 更新订单簿
    this.orderBookManager.update(depth);

    // 收集触发的成交事件
    const fills: OrderFilledEvent[] = [];

    // 获取订单簿
    const orderBook = this.orderBookManager.get(depth.exchange, depth.symbol);
    if (!orderBook) {
      return fills;
    }

    // 检查所有活跃限价单
    for (const order of this.activeOrders.values()) {
      // 只检查匹配的交易对
      if (order.exchange !== depth.exchange || order.symbol !== depth.symbol) {
        continue;
      }

      // 只检查限价单
      if (order.type !== 'limit') {
        continue;
      }

      // 只检查待处理或部分成交的订单
      if (order.status !== 'pending' && order.status !== 'partial') {
        continue;
      }

      // 检查是否可以成交
      const canFill = orderBook.canFillImmediately(order.side, order.price!);

      if (canFill) {
        // 计算成交数量
        const remainingQuantity = order.quantity - order.filledQuantity;
        const fillableQuantity = orderBook.getFillableQuantity(
          order.side,
          order.price!,
          remainingQuantity
        );

        if (fillableQuantity > 0) {
          // 生成成交事件
          const fillEvent = this.createFillEvent(
            order,
            order.price!, // 限价单以限价成交
            fillableQuantity,
            true // Maker 成交
          );

          // 更新订单状态
          this.updateOrderAfterFill(order, fillableQuantity, order.price!);

          fills.push(fillEvent);
        }
      }
    }

    return fills;
  }

  // ========================================================================
  // 公共方法 - 清理
  // ========================================================================

  /**
   * 清空所有订单
   */
  clear(): void {
    this.activeOrders.clear();
    this.clientOrderIdMap.clear();
    this.currentTimestamp = 0;
  }

  // ========================================================================
  // 私有方法 - 订单验证
  // ========================================================================

  /**
   * 验证订单参数
   * @param request - 订单请求
   * @returns 错误消息（无错误返回 undefined）
   */
  private validateOrder(request: OrderRequest): string | undefined {
    // 验证数量
    if (request.quantity <= 0) {
      return 'Order quantity must be positive';
    }

    if (request.quantity < this.config.minOrderQuantity) {
      return `Order quantity below minimum (${this.config.minOrderQuantity})`;
    }

    if (request.quantity > this.config.maxOrderQuantity) {
      return `Order quantity exceeds maximum (${this.config.maxOrderQuantity})`;
    }

    // 限价单必须有价格
    if (request.type === 'limit' && !request.price) {
      return 'Limit order must have a price';
    }

    // 验证价格
    if (request.price !== undefined && request.price <= 0) {
      return 'Order price must be positive';
    }

    // Reduce-Only 验证
    if (request.reduceOnly && this.config.enableReduceOnly) {
      const position = this.getPosition(request.exchange, request.symbol);

      // 没有持仓，不能使用 Reduce-Only
      if (!position || position.quantity === 0) {
        return 'Reduce-only order rejected: no position to reduce';
      }

      // 方向必须与持仓相反
      if (request.side === 'buy' && position.side !== 'short') {
        return 'Reduce-only buy order rejected: no short position';
      }

      if (request.side === 'sell' && position.side !== 'long') {
        return 'Reduce-only sell order rejected: no long position';
      }

      // 数量不能超过持仓
      if (request.quantity > position.quantity) {
        return `Reduce-only order quantity (${request.quantity}) exceeds position (${position.quantity})`;
      }
    }

    // 验证通过
    return undefined;
  }

  // ========================================================================
  // 私有方法 - 订单创建
  // ========================================================================

  /**
   * 创建订单对象
   * @param request - 订单请求
   */
  private createOrder(request: OrderRequest): Order {
    // 生成订单 ID
    const orderId = generateId();

    // 创建订单
    const order: Order = {
      id: orderId,
      clientOrderId: request.clientOrderId,
      exchange: request.exchange,
      symbol: request.symbol,
      side: request.side,
      type: request.type,
      quantity: request.quantity,
      price: request.price,
      postOnly: request.postOnly ?? false,
      reduceOnly: request.reduceOnly ?? false,
      status: 'pending',
      filledQuantity: 0,
      avgFillPrice: 0,
      totalFee: 0,
      createdAt: this.currentTimestamp,
      updatedAt: this.currentTimestamp,
    };

    return order;
  }

  // ========================================================================
  // 私有方法 - 市价单撮合
  // ========================================================================

  /**
   * 撮合市价单
   * @param order - 订单对象
   */
  private matchMarketOrder(order: Order): MatchResult {
    // 获取订单簿
    const orderBook = this.orderBookManager.get(order.exchange, order.symbol);

    // 没有订单簿数据
    if (!orderBook) {
      return {
        success: false,
        fills: [],
        error: 'No orderbook data available',
      };
    }

    // 计算成交价格（考虑滑点）
    const slippageResult = orderBook.calculateSlippage(order.side, order.quantity);

    // 检查是否可以成交
    if (!slippageResult.canFill) {
      return {
        success: false,
        fills: [],
        error: 'Insufficient liquidity',
      };
    }

    // 生成成交事件
    const fillEvent = this.createFillEvent(
      order,
      slippageResult.expectedPrice,
      order.quantity,
      false // Taker 成交
    );

    // 更新订单状态
    this.updateOrderAfterFill(order, order.quantity, slippageResult.expectedPrice);

    // 市价单不加入活跃订单（已完全成交）
    return {
      success: true,
      order,
      fills: [fillEvent],
    };
  }

  // ========================================================================
  // 私有方法 - 限价单撮合
  // ========================================================================

  /**
   * 撮合限价单
   * @param order - 订单对象
   */
  private matchLimitOrder(order: Order): MatchResult {
    // 获取订单簿
    const orderBook = this.orderBookManager.get(order.exchange, order.symbol);

    // 检查是否可以立即成交
    if (orderBook && orderBook.canFillImmediately(order.side, order.price!)) {
      // Post-Only 检查
      if (order.postOnly && this.config.enablePostOnly) {
        // Post-Only 订单如果会立即成交则拒绝
        order.status = 'rejected';
        order.rejectReason = 'Post-only order would immediately match';

        return {
          success: false,
          order,
          fills: [],
          rejectReason: order.rejectReason,
        };
      }

      // 计算可成交数量
      const fillableQuantity = orderBook.getFillableQuantity(
        order.side,
        order.price!,
        order.quantity
      );

      if (fillableQuantity > 0) {
        // 生成成交事件
        const fillEvent = this.createFillEvent(
          order,
          order.price!, // 限价单以限价成交
          fillableQuantity,
          false // 立即成交算 Taker
        );

        // 更新订单状态
        this.updateOrderAfterFill(order, fillableQuantity, order.price!);

        // 如果完全成交，不加入活跃订单
        if (order.status === 'filled') {
          return {
            success: true,
            order,
            fills: [fillEvent],
          };
        }

        // 部分成交，加入活跃订单
        this.addToActiveOrders(order);

        return {
          success: true,
          order,
          fills: [fillEvent],
        };
      }
    }

    // 未成交或部分成交，加入活跃订单等待撮合
    this.addToActiveOrders(order);

    return {
      success: true,
      order,
      fills: [],
    };
  }

  // ========================================================================
  // 私有方法 - 限价单触发检查
  // ========================================================================

  /**
   * 检查限价单是否被触发
   * @param order - 订单
   * @param tradePrice - 成交价格
   */
  private checkLimitOrderTriggered(order: Order, tradePrice: number): boolean {
    // 买单：成交价 <= 限价时触发
    if (order.side === 'buy') {
      return tradePrice <= order.price!;
    }

    // 卖单：成交价 >= 限价时触发
    return tradePrice >= order.price!;
  }

  // ========================================================================
  // 私有方法 - 成交处理
  // ========================================================================

  /**
   * 创建成交事件
   * @param order - 订单
   * @param fillPrice - 成交价格
   * @param fillQuantity - 成交数量
   * @param isMaker - 是否为 Maker
   */
  private createFillEvent(
    order: Order,
    fillPrice: number,
    fillQuantity: number,
    isMaker: boolean
  ): OrderFilledEvent {
    // 获取手续费配置
    const feeConfig = this.config.feeConfig[order.exchange] ?? DEFAULT_FEE_CONFIG[order.exchange];

    // 计算手续费
    const feeRate = isMaker ? feeConfig.makerFee : feeConfig.takerFee;
    const notional = fillPrice * fillQuantity;
    const fee = notional * feeRate;

    // 创建成交事件
    return {
      type: 'orderFilled',
      timestamp: this.currentTimestamp,
      exchange: order.exchange,
      symbol: order.symbol,
      orderId: order.id,
      fillPrice,
      fillQuantity,
      fee,
      feeCurrency: 'USDT',
      isMaker,
    };
  }

  /**
   * 更新订单成交后的状态
   * @param order - 订单
   * @param fillQuantity - 本次成交数量
   * @param fillPrice - 本次成交价格
   */
  private updateOrderAfterFill(
    order: Order,
    fillQuantity: number,
    fillPrice: number
  ): void {
    // 计算新的平均价格
    const prevNotional = order.avgFillPrice * order.filledQuantity;
    const newNotional = fillPrice * fillQuantity;
    const totalQuantity = order.filledQuantity + fillQuantity;

    // 更新平均价格
    order.avgFillPrice = totalQuantity > 0
      ? (prevNotional + newNotional) / totalQuantity
      : 0;

    // 更新已成交数量
    order.filledQuantity = totalQuantity;

    // 计算手续费
    const feeConfig = this.config.feeConfig[order.exchange] ?? DEFAULT_FEE_CONFIG[order.exchange];
    const fee = newNotional * feeConfig.takerFee; // 简化：使用 taker 费率
    order.totalFee += fee;

    // 更新订单状态
    if (order.filledQuantity >= order.quantity) {
      // 完全成交
      order.status = 'filled';
      // 从活跃订单中移除
      this.activeOrders.delete(order.id);
      if (order.clientOrderId) {
        this.clientOrderIdMap.delete(order.clientOrderId);
      }
    } else if (order.filledQuantity > 0) {
      // 部分成交
      order.status = 'partial';
    }

    // 更新时间
    order.updatedAt = this.currentTimestamp;
  }

  // ========================================================================
  // 私有方法 - 活跃订单管理
  // ========================================================================

  /**
   * 添加到活跃订单
   * @param order - 订单
   */
  private addToActiveOrders(order: Order): void {
    // 添加到映射
    this.activeOrders.set(order.id, order);

    // 如果有客户端 ID，添加映射
    if (order.clientOrderId) {
      this.clientOrderIdMap.set(order.clientOrderId, order.id);
    }
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建撮合引擎
 * @param orderBookManager - 订单簿管理器
 * @param getPosition - 持仓查询函数
 * @param config - 配置
 */
export function createMatchingEngine(
  orderBookManager: OrderBookManager,
  getPosition: (exchange: ExchangeId, symbol: string) => { side: string; quantity: number } | undefined,
  config?: MatchingEngineConfig
): MatchingEngine {
  return new MatchingEngine(orderBookManager, getPosition, config);
}
