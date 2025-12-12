// ============================================================================
// 订单执行器
// 智能订单执行，支持多种执行算法
// ============================================================================

import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import type { BaseExchange, Order, OrderRequest, Symbol } from '@quant/exchange';
import type { RiskManager } from '@quant/risk';

import type {
  ChildOrder,
  ExecutionAlgorithm,
  ExecutionParams,
  ExecutionRequest,
  ExecutionResult,
  ExecutionStatus,
  ExecutorConfig,
  ExecutorEvents,
} from './types.js';

// ============================================================================
// 执行器实现
// ============================================================================

/**
 * 订单执行器
 *
 * 功能：
 * - 智能订单执行
 * - 多种执行算法（TWAP、VWAP、冰山等）
 * - 风控集成
 * - 订单状态跟踪
 * - 执行报告生成
 */
export class OrderExecutor extends EventEmitter<ExecutorEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: ExecutorConfig;

  // 交易所实例
  private readonly exchange: BaseExchange;

  // 风控管理器（可选）
  private readonly riskManager?: RiskManager;

  // 活跃执行映射
  private readonly activeExecutions: Map<string, ExecutionRequest> = new Map();

  // 执行结果映射
  private readonly executionResults: Map<string, ExecutionResult> = new Map();

  // 子订单映射
  private readonly childOrders: Map<string, ChildOrder[]> = new Map();

  /**
   * 构造函数
   */
  public constructor(
    exchange: BaseExchange,
    config: Partial<ExecutorConfig> = {},
    riskManager?: RiskManager
  ) {
    super();

    this.exchange = exchange;
    this.riskManager = riskManager;

    // 合并默认配置
    this.config = {
      defaultAlgorithm: 'market',
      defaultTimeout: 60000, // 1 分钟
      maxConcurrentExecutions: 10,
      maxRetries: 3,
      retryDelay: 1000,
      enableRiskCheck: true,
      orderConfirmTimeout: 5000,
      simulationMode: false,
      ...config,
    };

    // 初始化日志
    this.logger = pino({
      name: 'OrderExecutor',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 监听交易所订单更新
    this.setupExchangeListeners();

    this.logger.info({ config: this.config }, 'OrderExecutor initialized');
  }

  /**
   * 设置交易所监听器
   */
  private setupExchangeListeners(): void {
    this.exchange.on('orderUpdate', (order: Order) => {
      this.handleOrderUpdate(order);
    });
  }

  // ==========================================================================
  // 执行方法
  // ==========================================================================

  /**
   * 执行订单
   */
  public async execute(
    orderRequest: OrderRequest,
    algorithm: ExecutionAlgorithm = this.config.defaultAlgorithm,
    params?: ExecutionParams
  ): Promise<ExecutionResult> {
    // 创建执行请求
    const request: ExecutionRequest = {
      id: uuidv4(),
      orderRequest,
      algorithm,
      params,
      createdAt: Date.now(),
      timeout: params?.duration ?? this.config.defaultTimeout,
    };

    // 检查并发限制
    if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      return this.createFailedResult(request, 'Max concurrent executions reached');
    }

    // 风控检查
    if (this.config.enableRiskCheck && this.riskManager) {
      if (!this.riskManager.canExecuteOrder(orderRequest)) {
        return this.createFailedResult(request, 'Risk check failed');
      }
    }

    // 添加到活跃执行
    this.activeExecutions.set(request.id, request);
    this.emit('executionStarted', request);

    this.logger.info(
      { requestId: request.id, algorithm, symbol: orderRequest.symbol },
      'Execution started'
    );

    try {
      // 根据算法执行
      let result: ExecutionResult;

      switch (algorithm) {
        case 'market':
          result = await this.executeMarket(request);
          break;
        case 'limit':
          result = await this.executeLimit(request);
          break;
        case 'twap':
          result = await this.executeTWAP(request);
          break;
        case 'iceberg':
          result = await this.executeIceberg(request);
          break;
        default:
          result = await this.executeMarket(request);
      }

      // 存储结果
      this.executionResults.set(request.id, result);

      // 移除活跃执行
      this.activeExecutions.delete(request.id);

      // 发出事件
      if (result.status === 'completed') {
        this.emit('executionCompleted', result);
      } else if (result.status === 'failed') {
        this.emit('executionFailed', result);
      }

      return result;
    } catch (error) {
      const result = this.createFailedResult(
        request,
        error instanceof Error ? error.message : 'Unknown error'
      );

      this.activeExecutions.delete(request.id);
      this.emit('executionFailed', result);

      return result;
    }
  }

  /**
   * 市价单执行
   */
  private async executeMarket(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // 直接执行市价单
      const order = await this.exchange.createOrder({
        ...request.orderRequest,
        type: 'market',
      });

      // 等待订单完成
      const finalOrder = await this.waitForOrderCompletion(order);

      return this.createResult(request, [finalOrder], startTime);
    } catch (error) {
      return this.createFailedResult(
        request,
        error instanceof Error ? error.message : 'Market execution failed'
      );
    }
  }

  /**
   * 限价单执行
   */
  private async executeLimit(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeout = request.timeout ?? this.config.defaultTimeout;

    try {
      // 创建限价单
      const order = await this.exchange.createOrder({
        ...request.orderRequest,
        type: 'limit',
      });

      // 等待订单完成或超时
      const finalOrder = await this.waitForOrderCompletion(order, timeout);

      // 如果未完全成交，取消剩余部分
      if (finalOrder.status !== 'filled') {
        await this.exchange.cancelOrder(finalOrder.id, finalOrder.symbol);
      }

      return this.createResult(request, [finalOrder], startTime);
    } catch (error) {
      return this.createFailedResult(
        request,
        error instanceof Error ? error.message : 'Limit execution failed'
      );
    }
  }

  /**
   * TWAP 执行（时间加权平均价格）
   */
  private async executeTWAP(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const params = request.params ?? {};

    // 默认参数
    const duration = params.duration ?? 300000; // 5 分钟
    const slices = params.slices ?? 10; // 10 个切片

    // 计算每个切片的数量和时间间隔
    const sliceAmount = request.orderRequest.amount.dividedBy(slices);
    const interval = duration / slices;

    const orders: Order[] = [];
    const childOrdersList: ChildOrder[] = [];

    try {
      for (let i = 0; i < slices; i++) {
        // 检查是否已取消
        if (!this.activeExecutions.has(request.id)) {
          break;
        }

        // 创建子订单
        const childOrderRequest: OrderRequest = {
          ...request.orderRequest,
          amount: sliceAmount,
          type: 'market',
        };

        const order = await this.exchange.createOrder(childOrderRequest);

        const childOrder: ChildOrder = {
          parentId: request.id,
          sequence: i + 1,
          order,
          scheduledTime: startTime + i * interval,
          executedTime: Date.now(),
        };

        childOrdersList.push(childOrder);
        orders.push(order);

        this.emit('childOrderCreated', childOrder);

        // 更新进度
        const progress = ((i + 1) / slices) * 100;
        const filledAmount = sliceAmount.times(i + 1);
        this.emit('executionProgress', request.id, progress, filledAmount);

        // 等待下一个切片
        if (i < slices - 1) {
          await this.sleep(interval);
        }
      }

      // 存储子订单
      this.childOrders.set(request.id, childOrdersList);

      return this.createResult(request, orders, startTime);
    } catch (error) {
      return this.createFailedResult(
        request,
        error instanceof Error ? error.message : 'TWAP execution failed'
      );
    }
  }

  /**
   * 冰山订单执行
   */
  private async executeIceberg(request: ExecutionRequest): Promise<ExecutionResult> {
    const startTime = Date.now();
    const params = request.params ?? {};

    // 显示数量（默认为总数量的 10%）
    const displaySize = params.displaySize ?? request.orderRequest.amount.times(0.1);

    // 计算需要多少轮
    const totalAmount = request.orderRequest.amount;
    const rounds = Math.ceil(totalAmount.dividedBy(displaySize).toNumber());

    const orders: Order[] = [];
    let remainingAmount = totalAmount;

    try {
      for (let i = 0; i < rounds; i++) {
        // 检查是否已取消
        if (!this.activeExecutions.has(request.id)) {
          break;
        }

        // 计算本轮数量
        const currentAmount = Decimal.min(displaySize, remainingAmount);

        // 创建订单
        const order = await this.exchange.createOrder({
          ...request.orderRequest,
          amount: currentAmount,
          type: 'limit',
        });

        // 等待订单完成
        const finalOrder = await this.waitForOrderCompletion(
          order,
          this.config.orderConfirmTimeout
        );

        orders.push(finalOrder);
        remainingAmount = remainingAmount.minus(finalOrder.filled);

        // 更新进度
        const progress = totalAmount.minus(remainingAmount).dividedBy(totalAmount).times(100);
        this.emit('executionProgress', request.id, progress.toNumber(), totalAmount.minus(remainingAmount));

        // 如果未完全成交，取消并重试
        if (finalOrder.status !== 'filled' && remainingAmount.greaterThan(0)) {
          await this.exchange.cancelOrder(finalOrder.id, finalOrder.symbol);
        }

        // 短暂延迟，避免被检测
        await this.sleep(100 + Math.random() * 200);
      }

      return this.createResult(request, orders, startTime);
    } catch (error) {
      return this.createFailedResult(
        request,
        error instanceof Error ? error.message : 'Iceberg execution failed'
      );
    }
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  /**
   * 等待订单完成
   */
  private async waitForOrderCompletion(order: Order, timeout?: number): Promise<Order> {
    const deadline = timeout ? Date.now() + timeout : undefined;

    while (true) {
      // 检查超时
      if (deadline && Date.now() > deadline) {
        return order;
      }

      // 查询最新订单状态
      const updatedOrder = await this.exchange.fetchOrder(order.id, order.symbol);

      // 检查是否完成
      if (
        updatedOrder.status === 'filled' ||
        updatedOrder.status === 'canceled' ||
        updatedOrder.status === 'rejected'
      ) {
        return updatedOrder;
      }

      // 等待后重试
      await this.sleep(500);
    }
  }

  /**
   * 处理订单更新
   */
  private handleOrderUpdate(order: Order): void {
    // 查找对应的子订单
    for (const [requestId, childOrders] of this.childOrders) {
      const childOrder = childOrders.find(co => co.order.id === order.id);
      if (childOrder) {
        // 更新子订单状态
        const updatedChildOrder: ChildOrder = {
          ...childOrder,
          order,
        };

        if (order.status === 'filled') {
          this.emit('childOrderFilled', updatedChildOrder);
        }

        break;
      }
    }
  }

  /**
   * 创建执行结果
   */
  private createResult(
    request: ExecutionRequest,
    orders: Order[],
    startTime: number
  ): ExecutionResult {
    const endTime = Date.now();

    // 计算总成交量
    const filledAmount = orders.reduce(
      (sum, order) => sum.plus(order.filled),
      new Decimal(0)
    );

    // 计算加权平均价格
    let avgPrice = new Decimal(0);
    if (!filledAmount.isZero()) {
      const totalValue = orders.reduce(
        (sum, order) => sum.plus(order.avgPrice.times(order.filled)),
        new Decimal(0)
      );
      avgPrice = totalValue.dividedBy(filledAmount);
    }

    // 计算总手续费
    const totalFee = orders.reduce((sum, order) => sum.plus(order.fee), new Decimal(0));

    // 计算滑点
    const expectedPrice = request.orderRequest.price ?? avgPrice;
    const slippage = expectedPrice.isZero()
      ? new Decimal(0)
      : avgPrice.minus(expectedPrice).dividedBy(expectedPrice).times(100).abs();

    // 确定状态
    let status: ExecutionStatus = 'completed';
    if (filledAmount.isZero()) {
      status = 'failed';
    } else if (filledAmount.lessThan(request.orderRequest.amount)) {
      status = 'partial';
    }

    return {
      requestId: request.id,
      status,
      orders,
      filledAmount,
      avgPrice,
      totalFee,
      slippage,
      startTime,
      endTime,
      duration: endTime - startTime,
    };
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(request: ExecutionRequest, reason: string): ExecutionResult {
    return {
      requestId: request.id,
      status: 'failed',
      orders: [],
      filledAmount: new Decimal(0),
      avgPrice: new Decimal(0),
      totalFee: new Decimal(0),
      slippage: new Decimal(0),
      startTime: request.createdAt,
      endTime: Date.now(),
      duration: Date.now() - request.createdAt,
      failReason: reason,
    };
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==========================================================================
  // 取消和查询
  // ==========================================================================

  /**
   * 取消执行
   */
  public async cancelExecution(requestId: string, reason: string = 'User cancelled'): Promise<boolean> {
    const request = this.activeExecutions.get(requestId);
    if (!request) {
      return false;
    }

    // 移除活跃执行
    this.activeExecutions.delete(requestId);

    // 取消所有相关订单
    const childOrders = this.childOrders.get(requestId) ?? [];
    for (const childOrder of childOrders) {
      if (childOrder.order.status === 'open' || childOrder.order.status === 'partially_filled') {
        try {
          await this.exchange.cancelOrder(childOrder.order.id, childOrder.order.symbol);
        } catch (error) {
          this.logger.warn(
            { orderId: childOrder.order.id, error },
            'Failed to cancel child order'
          );
        }
      }
    }

    this.emit('executionCancelled', requestId, reason);
    this.logger.info({ requestId, reason }, 'Execution cancelled');

    return true;
  }

  /**
   * 获取执行结果
   */
  public getExecutionResult(requestId: string): ExecutionResult | undefined {
    return this.executionResults.get(requestId);
  }

  /**
   * 获取活跃执行列表
   */
  public getActiveExecutions(): ExecutionRequest[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 获取子订单
   */
  public getChildOrders(requestId: string): ChildOrder[] {
    return this.childOrders.get(requestId) ?? [];
  }

  /**
   * 清理历史记录
   */
  public clearHistory(): void {
    this.executionResults.clear();
    this.childOrders.clear();
    this.logger.info('History cleared');
  }
}
