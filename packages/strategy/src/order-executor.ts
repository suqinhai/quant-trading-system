// ============================================================================
// 高可靠订单执行器
// 支持多账户并行下单、智能重试、自成交防护
// 核心功能：post-only/reduce-only、超时撤单、nonce/429处理、订单簿模拟
// ============================================================================

import {
  type ExchangeId,
  type Timestamp,
  type OrderSide,
} from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

// 订单类型
export type OrderType = 'market' | 'limit' | 'post_only' | 'fok' | 'ioc';

// 订单状态
export type OrderStatus =
  | 'pending'      // 等待提交
  | 'submitted'    // 已提交
  | 'partial'      // 部分成交
  | 'filled'       // 完全成交
  | 'cancelled'    // 已撤销
  | 'rejected'     // 被拒绝
  | 'expired';     // 已过期

// 订单请求
export interface OrderRequest {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 订单方向
  side: OrderSide;
  // 订单类型
  type: OrderType;
  // 数量
  quantity: number;
  // 价格（限价单必填）
  price?: number;
  // 是否 reduce-only（只减仓）
  reduceOnly?: boolean;
  // 客户端订单 ID
  clientOrderId?: string;
  // 超时时间（毫秒，默认 300ms）
  timeout?: number;
  // 重试次数（默认 3 次）
  maxRetries?: number;
  // 账户 ID（多账户时使用）
  accountId?: string;
}

// 订单结果
export interface OrderResult {
  // 是否成功
  success: boolean;
  // 订单 ID（交易所返回）
  orderId?: string;
  // 客户端订单 ID
  clientOrderId: string;
  // 订单状态
  status: OrderStatus;
  // 成交数量
  filledQuantity: number;
  // 成交均价
  avgPrice: number;
  // 手续费
  fee: number;
  // 错误信息
  error?: string;
  // 错误代码
  errorCode?: string;
  // 重试次数
  retryCount: number;
  // 执行时间（毫秒）
  executionTime: number;
  // 时间戳
  timestamp: Timestamp;
}

// 订单簿价格档位
export interface PriceLevel {
  // 价格
  price: number;
  // 数量
  quantity: number;
}

// 订单簿快照
export interface OrderBookSnapshot {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 买单（按价格降序）
  bids: PriceLevel[];
  // 卖单（按价格升序）
  asks: PriceLevel[];
  // 更新时间
  updatedAt: Timestamp;
}

// 账户配置
export interface AccountConfig {
  // 账户 ID
  accountId: string;
  // 交易所
  exchange: ExchangeId;
  // API Key
  apiKey: string;
  // API Secret
  apiSecret: string;
  // 密码（部分交易所需要）
  passphrase?: string;
  // 是否启用
  enabled: boolean;
  // 权重（用于负载均衡）
  weight: number;
  // 最大并发数
  maxConcurrent: number;
  // 当前 nonce
  currentNonce: number;
}

// 执行器配置
export interface OrderExecutorConfig {
  // 默认超时时间（毫秒）
  defaultTimeout: number;
  // 默认重试次数
  defaultMaxRetries: number;
  // 重试间隔（毫秒）
  retryInterval: number;
  // 429 错误等待时间（毫秒）
  rateLimitWaitTime: number;
  // nonce 冲突重试次数
  nonceRetryCount: number;
  // 是否启用自成交防护
  enableSelfTradeProtection: boolean;
  // 自成交安全距离（价格百分比）
  selfTradeDistance: number;
  // 订单簿深度（用于模拟）
  orderBookDepth: number;
  // 最大并行订单数
  maxParallelOrders: number;
  // 订单状态轮询间隔（毫秒）
  pollInterval: number;
}

// 默认执行器配置
const DEFAULT_EXECUTOR_CONFIG: OrderExecutorConfig = {
  // 默认 300ms 超时
  defaultTimeout: 300,
  // 默认重试 3 次
  defaultMaxRetries: 3,
  // 重试间隔 100ms
  retryInterval: 100,
  // 429 等待 1 秒
  rateLimitWaitTime: 1000,
  // nonce 冲突重试 5 次
  nonceRetryCount: 5,
  // 启用自成交防护
  enableSelfTradeProtection: true,
  // 自成交安全距离 0.01%
  selfTradeDistance: 0.0001,
  // 订单簿深度 20 档
  orderBookDepth: 20,
  // 最大并行 10 单
  maxParallelOrders: 10,
  // 轮询间隔 50ms
  pollInterval: 50,
};

// 内部订单状态
interface InternalOrder {
  // 订单请求
  request: OrderRequest;
  // 客户端订单 ID
  clientOrderId: string;
  // 交易所订单 ID
  exchangeOrderId?: string;
  // 当前状态
  status: OrderStatus;
  // 成交数量
  filledQuantity: number;
  // 成交均价
  avgPrice: number;
  // 累计手续费
  fee: number;
  // 重试次数
  retryCount: number;
  // 创建时间
  createdAt: Timestamp;
  // 提交时间
  submittedAt?: Timestamp;
  // 最后更新时间
  updatedAt: Timestamp;
  // 超时定时器
  timeoutTimer?: ReturnType<typeof setTimeout>;
  // 账户 ID
  accountId: string;
  // 当前 nonce
  nonce: number;
}

// 自有订单记录（用于自成交防护）
interface OwnOrder {
  // 客户端订单 ID
  clientOrderId: string;
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 方向
  side: OrderSide;
  // 价格
  price: number;
  // 剩余数量
  remainingQuantity: number;
  // 创建时间
  createdAt: Timestamp;
}

// 交易所适配器接口
export interface ExchangeAdapter {
  // 提交订单
  submitOrder(
    accountId: string,
    request: OrderRequest,
    nonce: number
  ): Promise<{ orderId: string; status: OrderStatus }>;

  // 撤销订单
  cancelOrder(
    accountId: string,
    exchange: ExchangeId,
    symbol: string,
    orderId: string
  ): Promise<boolean>;

  // 查询订单状态
  getOrderStatus(
    accountId: string,
    exchange: ExchangeId,
    symbol: string,
    orderId: string
  ): Promise<{
    status: OrderStatus;
    filledQuantity: number;
    avgPrice: number;
    fee: number;
  }>;

  // 获取订单簿
  getOrderBook(
    exchange: ExchangeId,
    symbol: string,
    depth: number
  ): Promise<OrderBookSnapshot>;
}

// 事件监听器类型
type OrderEventListener = (result: OrderResult) => void;

// ============================================================================
// 订单执行器类
// ============================================================================

/**
 * 高可靠订单执行器
 * 支持多账户并行下单、智能重试、自成交防护
 */
export class OrderExecutor {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: OrderExecutorConfig;

  // 交易所适配器
  private adapter: ExchangeAdapter;

  // 账户配置（accountId -> config）
  private accounts: Map<string, AccountConfig> = new Map();

  // 活跃订单（clientOrderId -> order）
  private activeOrders: Map<string, InternalOrder> = new Map();

  // 自有订单（用于自成交防护）
  private ownOrders: Map<string, OwnOrder> = new Map();

  // 订单簿缓存（exchange:symbol -> orderbook）
  private orderBooks: Map<string, OrderBookSnapshot> = new Map();

  // 账户锁（防止并发 nonce 冲突）
  private accountLocks: Map<string, Promise<void>> = new Map();

  // 当前并行订单数
  private parallelCount: number = 0;

  // 事件监听器
  private eventListeners: OrderEventListener[] = [];

  // 订单 ID 计数器
  private orderIdCounter: number = 0;

  // 是否正在运行
  private running: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param adapter - 交易所适配器
   * @param config - 执行器配置
   */
  constructor(
    adapter: ExchangeAdapter,
    config?: Partial<OrderExecutorConfig>
  ) {
    // 保存适配器
    this.adapter = adapter;

    // 合并配置
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动执行器
   */
  start(): void {
    this.running = true;
  }

  /**
   * 停止执行器
   */
  stop(): void {
    this.running = false;

    // 清除所有超时定时器
    for (const order of this.activeOrders.values()) {
      if (order.timeoutTimer) {
        clearTimeout(order.timeoutTimer);
      }
    }
  }

  /**
   * 重置执行器
   */
  reset(): void {
    // 停止
    this.stop();

    // 清空数据
    this.activeOrders.clear();
    this.ownOrders.clear();
    this.orderBooks.clear();
    this.accountLocks.clear();
    this.parallelCount = 0;
    this.orderIdCounter = 0;
  }

  // ========================================================================
  // 公共方法 - 账户管理
  // ========================================================================

  /**
   * 添加账户
   * @param config - 账户配置
   */
  addAccount(config: AccountConfig): void {
    this.accounts.set(config.accountId, {
      ...config,
      currentNonce: config.currentNonce || Date.now(),
    });
  }

  /**
   * 移除账户
   * @param accountId - 账户 ID
   */
  removeAccount(accountId: string): void {
    this.accounts.delete(accountId);
  }

  /**
   * 获取账户
   * @param accountId - 账户 ID
   */
  getAccount(accountId: string): AccountConfig | undefined {
    return this.accounts.get(accountId);
  }

  /**
   * 获取所有账户
   */
  getAllAccounts(): AccountConfig[] {
    return Array.from(this.accounts.values());
  }

  // ========================================================================
  // 公共方法 - 订单执行
  // ========================================================================

  /**
   * 执行单个订单
   * @param request - 订单请求
   */
  async executeOrder(request: OrderRequest): Promise<OrderResult> {
    // 检查是否正在运行
    if (!this.running) {
      return this.createErrorResult(
        request,
        'EXECUTOR_STOPPED',
        '执行器未启动'
      );
    }

    // 检查并行数量
    if (this.parallelCount >= this.config.maxParallelOrders) {
      return this.createErrorResult(
        request,
        'MAX_PARALLEL_EXCEEDED',
        `并行订单数超过限制 ${this.config.maxParallelOrders}`
      );
    }

    // 获取账户
    const accountId = request.accountId || this.selectAccount(request.exchange);
    if (!accountId) {
      return this.createErrorResult(
        request,
        'NO_ACCOUNT',
        `未找到交易所 ${request.exchange} 的可用账户`
      );
    }

    const account = this.accounts.get(accountId);
    if (!account || !account.enabled) {
      return this.createErrorResult(
        request,
        'ACCOUNT_DISABLED',
        `账户 ${accountId} 未启用`
      );
    }

    // 生成客户端订单 ID
    const clientOrderId = request.clientOrderId || this.generateOrderId();

    // 记录开始时间
    const startTime = Date.now();

    // 增加并行计数
    this.parallelCount++;

    try {
      // 执行订单（带重试）
      const result = await this.executeWithRetry(
        { ...request, clientOrderId, accountId },
        account
      );

      // 计算执行时间
      result.executionTime = Date.now() - startTime;

      // 触发事件
      this.emitOrderEvent(result);

      return result;
    } finally {
      // 减少并行计数
      this.parallelCount--;
    }
  }

  /**
   * 批量执行订单（并行）
   * @param requests - 订单请求数组
   */
  async executeOrders(requests: OrderRequest[]): Promise<OrderResult[]> {
    // 并行执行所有订单
    const promises = requests.map((request) => this.executeOrder(request));

    // 等待所有订单完成
    return Promise.all(promises);
  }

  /**
   * 执行 post-only 订单
   * @param request - 订单请求
   */
  async executePostOnly(request: OrderRequest): Promise<OrderResult> {
    // 强制设置为 post_only 类型
    const postOnlyRequest: OrderRequest = {
      ...request,
      type: 'post_only',
    };

    // 检查自成交风险
    if (this.config.enableSelfTradeProtection) {
      const adjustedPrice = await this.adjustPriceForSelfTrade(postOnlyRequest);
      if (adjustedPrice !== null) {
        postOnlyRequest.price = adjustedPrice;
      }
    }

    return this.executeOrder(postOnlyRequest);
  }

  /**
   * 执行 reduce-only 订单（只减仓）
   * @param request - 订单请求
   */
  async executeReduceOnly(request: OrderRequest): Promise<OrderResult> {
    // 强制设置 reduceOnly 标志
    const reduceOnlyRequest: OrderRequest = {
      ...request,
      reduceOnly: true,
    };

    return this.executeOrder(reduceOnlyRequest);
  }

  /**
   * 紧急全平所有仓位
   */
  async emergencyCloseAll(): Promise<OrderResult[]> {
    // 收集所有活跃订单的结果
    const results: OrderResult[] = [];

    // 先撤销所有活跃订单
    await this.cancelAllOrders();

    // 注意：实际全平逻辑需要获取当前持仓信息
    // 这里只是接口定义，具体实现需要配合持仓管理模块

    return results;
  }

  /**
   * 撤销指定订单
   * @param clientOrderId - 客户端订单 ID
   */
  async cancelOrder(clientOrderId: string): Promise<boolean> {
    // 获取订单
    const order = this.activeOrders.get(clientOrderId);
    if (!order) {
      return false;
    }

    // 如果没有交易所订单 ID，直接移除
    if (!order.exchangeOrderId) {
      this.removeOrder(clientOrderId);
      return true;
    }

    try {
      // 调用适配器撤单
      const success = await this.adapter.cancelOrder(
        order.accountId,
        order.request.exchange,
        order.request.symbol,
        order.exchangeOrderId
      );

      // 更新状态
      if (success) {
        order.status = 'cancelled';
        order.updatedAt = Date.now();
        this.removeOrder(clientOrderId);
      }

      return success;
    } catch (error) {
      // 撤单失败
      return false;
    }
  }

  /**
   * 撤销所有活跃订单
   */
  async cancelAllOrders(): Promise<void> {
    // 获取所有活跃订单 ID
    const orderIds = Array.from(this.activeOrders.keys());

    // 并行撤销
    await Promise.all(orderIds.map((id) => this.cancelOrder(id)));
  }

  // ========================================================================
  // 公共方法 - 订单簿管理
  // ========================================================================

  /**
   * 更新订单簿
   * @param orderBook - 订单簿快照
   */
  updateOrderBook(orderBook: OrderBookSnapshot): void {
    const key = this.getOrderBookKey(orderBook.exchange, orderBook.symbol);
    this.orderBooks.set(key, {
      ...orderBook,
      updatedAt: Date.now(),
    });
  }

  /**
   * 获取订单簿
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getOrderBook(
    exchange: ExchangeId,
    symbol: string
  ): OrderBookSnapshot | undefined {
    const key = this.getOrderBookKey(exchange, symbol);
    return this.orderBooks.get(key);
  }

  // ========================================================================
  // 公共方法 - 事件监听
  // ========================================================================

  /**
   * 添加订单事件监听器
   * @param listener - 监听器函数
   */
  onOrderComplete(listener: OrderEventListener): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除订单事件监听器
   * @param listener - 监听器函数
   */
  offOrderComplete(listener: OrderEventListener): void {
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
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取活跃订单数量
   */
  getActiveOrderCount(): number {
    return this.activeOrders.size;
  }

  /**
   * 获取所有活跃订单
   */
  getActiveOrders(): InternalOrder[] {
    return Array.from(this.activeOrders.values());
  }

  /**
   * 获取当前并行数
   */
  getParallelCount(): number {
    return this.parallelCount;
  }

  // ========================================================================
  // 私有方法 - 订单执行
  // ========================================================================

  /**
   * 带重试的订单执行
   * @param request - 订单请求
   * @param account - 账户配置
   */
  private async executeWithRetry(
    request: OrderRequest & { clientOrderId: string; accountId: string },
    account: AccountConfig
  ): Promise<OrderResult> {
    // 获取最大重试次数
    const maxRetries = request.maxRetries ?? this.config.defaultMaxRetries;

    // 创建内部订单
    const internalOrder: InternalOrder = {
      request,
      clientOrderId: request.clientOrderId,
      status: 'pending',
      filledQuantity: 0,
      avgPrice: 0,
      fee: 0,
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      accountId: request.accountId,
      nonce: 0,
    };

    // 添加到活跃订单
    this.activeOrders.set(request.clientOrderId, internalOrder);

    // 添加到自有订单（用于自成交防护）
    if (request.type === 'limit' || request.type === 'post_only') {
      this.addOwnOrder(request);
    }

    try {
      // 重试循环
      for (let retry = 0; retry <= maxRetries; retry++) {
        // 更新重试次数
        internalOrder.retryCount = retry;

        // 获取账户锁（防止 nonce 冲突）
        await this.acquireAccountLock(request.accountId);

        try {
          // 获取并递增 nonce
          const nonce = this.getNextNonce(request.accountId);
          internalOrder.nonce = nonce;

          // 提交订单
          const submitResult = await this.submitOrderWithTimeout(
            request,
            account,
            nonce,
            internalOrder
          );

          // 如果成功或完全成交，返回结果
          if (submitResult.success || submitResult.status === 'filled') {
            return submitResult;
          }

          // 如果是不可重试的错误，直接返回
          if (!this.isRetryableError(submitResult.errorCode)) {
            return submitResult;
          }

          // 处理特殊错误
          if (submitResult.errorCode === 'RATE_LIMIT') {
            // 429 错误，等待后重试
            await this.sleep(this.config.rateLimitWaitTime);
          } else if (submitResult.errorCode === 'NONCE_CONFLICT') {
            // nonce 冲突，等待后重试
            await this.sleep(this.config.retryInterval);
          } else {
            // 其他错误，等待后重试
            await this.sleep(this.config.retryInterval);
          }
        } finally {
          // 释放账户锁
          this.releaseAccountLock(request.accountId);
        }
      }

      // 重试耗尽
      return this.createErrorResult(
        request,
        'MAX_RETRIES_EXCEEDED',
        `重试次数耗尽 (${maxRetries})`
      );
    } finally {
      // 从活跃订单中移除
      this.removeOrder(request.clientOrderId);

      // 从自有订单中移除
      this.removeOwnOrder(request.clientOrderId);
    }
  }

  /**
   * 带超时的订单提交
   * @param request - 订单请求
   * @param account - 账户配置
   * @param nonce - nonce 值
   * @param internalOrder - 内部订单对象
   */
  private async submitOrderWithTimeout(
    request: OrderRequest & { clientOrderId: string; accountId: string },
    _account: AccountConfig,
    nonce: number,
    internalOrder: InternalOrder
  ): Promise<OrderResult> {
    // 获取超时时间
    const timeout = request.timeout ?? this.config.defaultTimeout;

    try {
      // 检查自成交风险
      if (
        this.config.enableSelfTradeProtection &&
        request.price !== undefined
      ) {
        const selfTradeRisk = this.checkSelfTradeRisk(request);
        if (selfTradeRisk) {
          return this.createErrorResult(
            request,
            'SELF_TRADE_RISK',
            `存在自成交风险: ${selfTradeRisk}`
          );
        }
      }

      // 提交订单到交易所
      const submitResult = await this.adapter.submitOrder(
        request.accountId,
        request,
        nonce
      );

      // 保存交易所订单 ID
      internalOrder.exchangeOrderId = submitResult.orderId;
      internalOrder.status = submitResult.status;
      internalOrder.submittedAt = Date.now();
      internalOrder.updatedAt = Date.now();

      // 如果是市价单或立即成交，直接查询状态
      if (request.type === 'market' || submitResult.status === 'filled') {
        const orderStatus = await this.adapter.getOrderStatus(
          request.accountId,
          request.exchange,
          request.symbol,
          submitResult.orderId
        );

        return this.createSuccessResult(request, submitResult.orderId, orderStatus);
      }

      // 限价单：等待成交或超时
      return await this.waitForFillOrTimeout(
        request,
        submitResult.orderId,
        timeout,
        internalOrder
      );
    } catch (error) {
      // 处理错误
      return this.handleSubmitError(request, error);
    }
  }

  /**
   * 等待订单成交或超时
   * @param request - 订单请求
   * @param orderId - 交易所订单 ID
   * @param timeout - 超时时间
   * @param internalOrder - 内部订单对象
   */
  private async waitForFillOrTimeout(
    request: OrderRequest & { clientOrderId: string; accountId: string },
    orderId: string,
    timeout: number,
    internalOrder: InternalOrder
  ): Promise<OrderResult> {
    // 计算超时时间点
    const deadline = Date.now() + timeout;

    // 轮询等待
    while (Date.now() < deadline) {
      try {
        // 查询订单状态
        const orderStatus = await this.adapter.getOrderStatus(
          request.accountId,
          request.exchange,
          request.symbol,
          orderId
        );

        // 更新内部订单状态
        internalOrder.status = orderStatus.status;
        internalOrder.filledQuantity = orderStatus.filledQuantity;
        internalOrder.avgPrice = orderStatus.avgPrice;
        internalOrder.fee = orderStatus.fee;
        internalOrder.updatedAt = Date.now();

        // 如果完全成交，返回成功
        if (orderStatus.status === 'filled') {
          return this.createSuccessResult(request, orderId, orderStatus);
        }

        // 如果被取消或拒绝，返回对应结果
        if (
          orderStatus.status === 'cancelled' ||
          orderStatus.status === 'rejected'
        ) {
          return this.createErrorResult(
            request,
            orderStatus.status.toUpperCase(),
            `订单被 ${orderStatus.status}`
          );
        }

        // 等待下一次轮询
        await this.sleep(this.config.pollInterval);
      } catch (error) {
        // 查询失败，继续等待
        await this.sleep(this.config.pollInterval);
      }
    }

    // 超时，尝试撤单
    try {
      // 撤销订单
      await this.adapter.cancelOrder(
        request.accountId,
        request.exchange,
        request.symbol,
        orderId
      );

      // 查询最终状态
      const finalStatus = await this.adapter.getOrderStatus(
        request.accountId,
        request.exchange,
        request.symbol,
        orderId
      );

      // 如果有部分成交
      if (finalStatus.filledQuantity > 0) {
        return {
          success: true,
          orderId,
          clientOrderId: request.clientOrderId,
          status: 'partial',
          filledQuantity: finalStatus.filledQuantity,
          avgPrice: finalStatus.avgPrice,
          fee: finalStatus.fee,
          retryCount: internalOrder.retryCount,
          executionTime: 0,
          timestamp: Date.now(),
        };
      }

      // 没有成交，返回超时错误（触发重试）
      return this.createErrorResult(
        request,
        'TIMEOUT',
        `订单超时 ${timeout}ms 未完全成交，已撤单`
      );
    } catch (cancelError) {
      // 撤单失败
      return this.createErrorResult(
        request,
        'CANCEL_FAILED',
        `撤单失败: ${cancelError}`
      );
    }
  }

  /**
   * 处理提交错误
   * @param request - 订单请求
   * @param error - 错误对象
   */
  private handleSubmitError(
    request: OrderRequest,
    error: unknown
  ): OrderResult {
    // 提取错误信息
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = this.extractErrorCode(error);

    return this.createErrorResult(request, errorCode, errorMessage);
  }

  /**
   * 提取错误代码
   * @param error - 错误对象
   */
  private extractErrorCode(error: unknown): string {
    // 尝试从错误对象中提取代码
    if (error && typeof error === 'object') {
      const err = error as Record<string, unknown>;

      // 检查常见的错误代码字段
      if (err.code) return String(err.code);
      if (err.errorCode) return String(err.errorCode);

      // 检查是否是 429 错误
      if (err.status === 429 || err.statusCode === 429) {
        return 'RATE_LIMIT';
      }

      // 检查 nonce 冲突
      const message = String(err.message || '').toLowerCase();
      if (message.includes('nonce') || message.includes('timestamp')) {
        return 'NONCE_CONFLICT';
      }
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * 检查是否是可重试的错误
   * @param errorCode - 错误代码
   */
  private isRetryableError(errorCode?: string): boolean {
    // 可重试的错误代码
    const retryableErrors = [
      'TIMEOUT',
      'RATE_LIMIT',
      'NONCE_CONFLICT',
      'NETWORK_ERROR',
      'SERVICE_UNAVAILABLE',
      'PARTIAL',
    ];

    return retryableErrors.includes(errorCode || '');
  }

  // ========================================================================
  // 私有方法 - 自成交防护
  // ========================================================================

  /**
   * 添加自有订单
   * @param request - 订单请求
   */
  private addOwnOrder(request: OrderRequest): void {
    // 只有限价单才需要记录
    if (!request.price || !request.clientOrderId) {
      return;
    }

    const ownOrder: OwnOrder = {
      clientOrderId: request.clientOrderId,
      exchange: request.exchange,
      symbol: request.symbol,
      side: request.side,
      price: request.price,
      remainingQuantity: request.quantity,
      createdAt: Date.now(),
    };

    this.ownOrders.set(request.clientOrderId, ownOrder);
  }

  /**
   * 移除自有订单
   * @param clientOrderId - 客户端订单 ID
   */
  private removeOwnOrder(clientOrderId: string): void {
    this.ownOrders.delete(clientOrderId);
  }

  /**
   * 检查自成交风险
   * @param request - 订单请求
   */
  private checkSelfTradeRisk(request: OrderRequest): string | null {
    // 如果没有价格，无法检查
    if (!request.price) {
      return null;
    }

    // 遍历自有订单
    for (const ownOrder of this.ownOrders.values()) {
      // 检查是否是同一交易对
      if (
        ownOrder.exchange !== request.exchange ||
        ownOrder.symbol !== request.symbol
      ) {
        continue;
      }

      // 检查是否是相反方向
      if (ownOrder.side === request.side) {
        continue;
      }

      // 检查价格是否会交叉
      if (request.side === 'buy') {
        // 买单：如果买入价格 >= 现有卖单价格，存在自成交风险
        if (request.price >= ownOrder.price) {
          return `买单价格 ${request.price} >= 现有卖单价格 ${ownOrder.price}`;
        }
      } else {
        // 卖单：如果卖出价格 <= 现有买单价格，存在自成交风险
        if (request.price <= ownOrder.price) {
          return `卖单价格 ${request.price} <= 现有买单价格 ${ownOrder.price}`;
        }
      }
    }

    return null;
  }

  /**
   * 调整价格以避免自成交
   * @param request - 订单请求
   */
  private async adjustPriceForSelfTrade(
    request: OrderRequest
  ): Promise<number | null> {
    // 如果没有价格，无法调整
    if (!request.price) {
      return null;
    }

    // 获取订单簿
    let orderBook = this.getOrderBook(request.exchange, request.symbol);

    // 如果没有缓存，尝试获取
    if (!orderBook) {
      try {
        orderBook = await this.adapter.getOrderBook(
          request.exchange,
          request.symbol,
          this.config.orderBookDepth
        );
        this.updateOrderBook(orderBook);
      } catch (error) {
        // 获取失败，返回原价格
        return null;
      }
    }

    // 计算安全价格
    const safeDistance = request.price * this.config.selfTradeDistance;

    if (request.side === 'buy') {
      // 买单：确保价格低于最优卖价
      const bestAsk = orderBook.asks[0]?.price;
      if (bestAsk && request.price >= bestAsk - safeDistance) {
        // 调整为最优卖价 - 安全距离
        return bestAsk - safeDistance;
      }
    } else {
      // 卖单：确保价格高于最优买价
      const bestBid = orderBook.bids[0]?.price;
      if (bestBid && request.price <= bestBid + safeDistance) {
        // 调整为最优买价 + 安全距离
        return bestBid + safeDistance;
      }
    }

    return null;
  }

  // ========================================================================
  // 私有方法 - 账户管理
  // ========================================================================

  /**
   * 选择账户（负载均衡）
   * @param exchange - 交易所
   */
  private selectAccount(exchange: ExchangeId): string | undefined {
    // 获取该交易所的所有启用账户
    const availableAccounts = Array.from(this.accounts.values()).filter(
      (account) => account.exchange === exchange && account.enabled
    );

    // 如果没有可用账户，返回 undefined
    if (availableAccounts.length === 0) {
      return undefined;
    }

    // 按权重随机选择（简单的加权随机）
    const totalWeight = availableAccounts.reduce(
      (sum, account) => sum + account.weight,
      0
    );
    let random = Math.random() * totalWeight;

    for (const account of availableAccounts) {
      random -= account.weight;
      if (random <= 0) {
        return account.accountId;
      }
    }

    // 兜底返回第一个
    return availableAccounts[0]?.accountId;
  }

  /**
   * 获取下一个 nonce
   * @param accountId - 账户 ID
   */
  private getNextNonce(accountId: string): number {
    const account = this.accounts.get(accountId);
    if (!account) {
      return Date.now();
    }

    // 递增 nonce（使用时间戳 + 计数器确保唯一）
    account.currentNonce = Math.max(account.currentNonce + 1, Date.now());

    return account.currentNonce;
  }

  /**
   * 获取账户锁
   * @param accountId - 账户 ID
   */
  private async acquireAccountLock(accountId: string): Promise<void> {
    // 等待现有锁释放
    const existingLock = this.accountLocks.get(accountId);
    if (existingLock) {
      await existingLock;
    }

    // 创建新锁
    let releaseLock: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // 保存锁和释放函数
    this.accountLocks.set(accountId, lock);

    // 保存释放函数到锁对象
    (lock as unknown as { release: () => void }).release = releaseLock!;
  }

  /**
   * 释放账户锁
   * @param accountId - 账户 ID
   */
  private releaseAccountLock(accountId: string): void {
    const lock = this.accountLocks.get(accountId);
    if (lock && (lock as unknown as { release: () => void }).release) {
      (lock as unknown as { release: () => void }).release();
    }
    this.accountLocks.delete(accountId);
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 生成订单 ID
   */
  private generateOrderId(): string {
    this.orderIdCounter++;
    return `${Date.now()}-${this.orderIdCounter.toString().padStart(6, '0')}`;
  }

  /**
   * 获取订单簿键
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  private getOrderBookKey(exchange: ExchangeId, symbol: string): string {
    return `${exchange}:${symbol}`;
  }

  /**
   * 创建成功结果
   * @param request - 订单请求
   * @param orderId - 订单 ID
   * @param status - 订单状态
   */
  private createSuccessResult(
    request: OrderRequest,
    orderId: string,
    status: {
      status: OrderStatus;
      filledQuantity: number;
      avgPrice: number;
      fee: number;
    }
  ): OrderResult {
    return {
      success: true,
      orderId,
      clientOrderId: request.clientOrderId || '',
      status: status.status,
      filledQuantity: status.filledQuantity,
      avgPrice: status.avgPrice,
      fee: status.fee,
      retryCount: 0,
      executionTime: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * 创建错误结果
   * @param request - 订单请求
   * @param errorCode - 错误代码
   * @param errorMessage - 错误消息
   */
  private createErrorResult(
    request: OrderRequest,
    errorCode: string,
    errorMessage: string
  ): OrderResult {
    return {
      success: false,
      clientOrderId: request.clientOrderId || '',
      status: 'rejected',
      filledQuantity: 0,
      avgPrice: 0,
      fee: 0,
      error: errorMessage,
      errorCode,
      retryCount: 0,
      executionTime: 0,
      timestamp: Date.now(),
    };
  }

  /**
   * 从活跃订单中移除
   * @param clientOrderId - 客户端订单 ID
   */
  private removeOrder(clientOrderId: string): void {
    const order = this.activeOrders.get(clientOrderId);
    if (order?.timeoutTimer) {
      clearTimeout(order.timeoutTimer);
    }
    this.activeOrders.delete(clientOrderId);
  }

  /**
   * 触发订单事件
   * @param result - 订单结果
   */
  private emitOrderEvent(result: OrderResult): void {
    for (const listener of this.eventListeners) {
      try {
        listener(result);
      } catch (error) {
        // 忽略监听器错误
        console.error('订单事件监听器错误:', error);
      }
    }
  }

  /**
   * 等待指定时间
   * @param ms - 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建订单执行器
 * @param adapter - 交易所适配器
 * @param config - 配置
 */
export function createOrderExecutor(
  adapter: ExchangeAdapter,
  config?: Partial<OrderExecutorConfig>
): OrderExecutor {
  return new OrderExecutor(adapter, config);
}

// 导出默认配置
export { DEFAULT_EXECUTOR_CONFIG };
