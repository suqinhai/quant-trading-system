// ============================================================================
// 模拟经纪商
// 处理订单执行、仓位管理和资金管理
// ============================================================================

import Decimal from 'decimal.js';
import pino from 'pino';

import type { Order, OrderRequest, OrderSide, OrderStatus, Symbol } from '@quant/exchange';

import type {
  BacktestConfig,
  BacktestPosition,
  ClosedTrade,
  CommissionConfig,
  OrderEvent,
  PositionEvent,
  SlippageConfig,
} from './types';
import { EventType } from './types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 经纪商状态
 */
interface BrokerState {
  // 现金余额
  cash: Decimal;

  // 持仓映射
  positions: Map<Symbol, BacktestPosition>;

  // 未完成订单
  pendingOrders: Map<string, Order>;

  // 已完成交易
  closedTrades: ClosedTrade[];

  // 订单计数器
  orderCounter: number;

  // 交易计数器
  tradeCounter: number;
}

// ============================================================================
// 模拟经纪商实现
// ============================================================================

/**
 * 模拟经纪商
 *
 * 功能：
 * - 订单验证和执行
 * - 仓位管理
 * - 手续费和滑点计算
 * - 盈亏计算
 */
export class SimulatedBroker {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: BacktestConfig;

  // 经纪商状态
  private state: BrokerState;

  // 当前时间（由引擎更新）
  private currentTime: number = 0;

  // 当前价格映射
  private currentPrices: Map<Symbol, Decimal> = new Map();

  /**
   * 构造函数
   * @param config - 回测配置
   */
  public constructor(config: BacktestConfig) {
    this.config = config;

    // 初始化日志
    this.logger = pino({
      name: 'SimulatedBroker',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化状态
    this.state = {
      cash: config.initialCapital,
      positions: new Map(),
      pendingOrders: new Map(),
      closedTrades: [],
      orderCounter: 0,
      tradeCounter: 0,
    };
  }

  // ==========================================================================
  // 状态访问器
  // ==========================================================================

  /**
   * 获取当前现金
   */
  public get cash(): Decimal {
    return this.state.cash;
  }

  /**
   * 获取当前持仓
   */
  public get positions(): Map<Symbol, BacktestPosition> {
    return new Map(this.state.positions);
  }

  /**
   * 获取已完成交易
   */
  public get closedTrades(): ClosedTrade[] {
    return [...this.state.closedTrades];
  }

  /**
   * 计算总权益
   */
  public get equity(): Decimal {
    let positionValue = new Decimal(0);

    for (const position of this.state.positions.values()) {
      const currentPrice = this.currentPrices.get(position.symbol);
      if (currentPrice) {
        positionValue = positionValue.plus(position.quantity.times(currentPrice));
      }
    }

    return this.state.cash.plus(positionValue);
  }

  // ==========================================================================
  // 时间和价格更新
  // ==========================================================================

  /**
   * 更新当前时间
   */
  public setCurrentTime(timestamp: number): void {
    this.currentTime = timestamp;
  }

  /**
   * 更新当前价格
   */
  public updatePrice(symbol: Symbol, price: Decimal): void {
    this.currentPrices.set(symbol, price);

    // 更新持仓的未实现盈亏
    const position = this.state.positions.get(symbol);
    if (position) {
      this.updatePositionPnl(position, price);
    }
  }

  /**
   * 更新仓位的未实现盈亏
   */
  private updatePositionPnl(position: BacktestPosition, currentPrice: Decimal): void {
    const pnl =
      position.side === 'long'
        ? currentPrice.minus(position.entryPrice).times(position.quantity)
        : position.entryPrice.minus(currentPrice).times(position.quantity);

    const pnlPercent =
      position.side === 'long'
        ? currentPrice.minus(position.entryPrice).dividedBy(position.entryPrice).times(100)
        : position.entryPrice.minus(currentPrice).dividedBy(position.entryPrice).times(100);

    // 创建更新后的仓位
    const updatedPosition: BacktestPosition = {
      ...position,
      currentPrice,
      unrealizedPnl: pnl,
      unrealizedPnlPercent: pnlPercent,
    };

    this.state.positions.set(position.symbol, updatedPosition);
  }

  // ==========================================================================
  // 订单处理
  // ==========================================================================

  /**
   * 提交订单
   * @returns 订单事件数组
   */
  public submitOrder(request: OrderRequest): OrderEvent[] {
    const events: OrderEvent[] = [];

    // 验证订单
    const validationError = this.validateOrder(request);
    if (validationError) {
      // 订单被拒绝
      const order = this.createOrder(request, 'rejected');
      events.push({
        type: EventType.ORDER_REJECTED,
        timestamp: this.currentTime,
        order,
        rejectReason: validationError,
      });
      return events;
    }

    // 创建订单
    const order = this.createOrder(request, 'open');

    // 对于市价单，立即执行
    if (request.type === 'market') {
      const fillEvents = this.fillOrder(order);
      events.push(...fillEvents);
    } else {
      // 限价单加入待处理队列
      this.state.pendingOrders.set(order.id, order);
      events.push({
        type: EventType.ORDER,
        timestamp: this.currentTime,
        order,
      });
    }

    return events;
  }

  /**
   * 验证订单
   * @returns 错误消息，如果有效则返回 undefined
   */
  private validateOrder(request: OrderRequest): string | undefined {
    // 检查交易对是否在配置中
    if (!this.config.symbols.includes(request.symbol)) {
      return `Symbol not allowed: ${request.symbol}`;
    }

    // 检查当前价格是否可用
    const currentPrice = this.currentPrices.get(request.symbol);
    if (!currentPrice) {
      return `No price available for ${request.symbol}`;
    }

    // 计算订单金额
    const orderValue = request.amount.times(request.price ?? currentPrice);

    // 检查是否是开仓订单
    const existingPosition = this.state.positions.get(request.symbol);
    const isOpeningPosition =
      !existingPosition ||
      (existingPosition.side === 'long' && request.side === 'buy') ||
      (existingPosition.side === 'short' && request.side === 'sell');

    if (isOpeningPosition) {
      // 检查现金是否足够
      const requiredCash = this.config.marginEnabled
        ? orderValue.dividedBy(this.config.leverage)
        : orderValue;

      if (requiredCash.greaterThan(this.state.cash)) {
        return 'Insufficient funds';
      }

      // 检查仓位大小限制
      const positionRatio = orderValue.dividedBy(this.equity);
      if (positionRatio.greaterThan(this.config.maxPositionSize)) {
        return 'Position size exceeds limit';
      }

      // 检查最大持仓数量
      if (this.state.positions.size >= this.config.maxOpenPositions && !existingPosition) {
        return 'Max open positions reached';
      }
    }

    // 检查做空限制
    if (request.side === 'sell' && !existingPosition && !this.config.allowShort) {
      return 'Short selling not allowed';
    }

    return undefined;
  }

  /**
   * 创建订单对象
   */
  private createOrder(request: OrderRequest, status: OrderStatus): Order {
    this.state.orderCounter++;
    const orderId = `BT-${this.state.orderCounter}`;
    const currentPrice = this.currentPrices.get(request.symbol) ?? new Decimal(0);

    return {
      id: orderId,
      clientOrderId: request.clientOrderId,
      symbol: request.symbol,
      exchangeId: 'backtest',
      side: request.side,
      type: request.type,
      status,
      price: request.price ?? currentPrice,
      amount: request.amount,
      filled: new Decimal(0),
      remaining: request.amount,
      avgPrice: new Decimal(0),
      fee: new Decimal(0),
      feeCurrency: 'USDT',
      timestamp: this.currentTime,
      lastUpdateTime: this.currentTime,
    };
  }

  /**
   * 执行订单成交
   */
  private fillOrder(order: Order): OrderEvent[] {
    const events: OrderEvent[] = [];

    // 获取执行价格（考虑滑点）
    const basePrice = this.currentPrices.get(order.symbol)!;
    const executionPrice = this.applySlippage(basePrice, order.side);

    // 计算手续费
    const commission = this.calculateCommission(order.amount, executionPrice);

    // 更新订单状态
    const filledOrder: Order = {
      ...order,
      status: 'filled',
      filled: order.amount,
      remaining: new Decimal(0),
      avgPrice: executionPrice,
      fee: commission,
      lastUpdateTime: this.currentTime,
    };

    // 更新仓位
    const positionEvents = this.updatePosition(filledOrder, executionPrice, commission);
    events.push(...positionEvents);

    // 添加订单成交事件
    events.push({
      type: EventType.ORDER_FILLED,
      timestamp: this.currentTime,
      order: filledOrder,
    });

    return events;
  }

  /**
   * 应用滑点
   */
  private applySlippage(price: Decimal, side: OrderSide): Decimal {
    const slippage = this.config.slippage;
    let slippageAmount: Decimal;

    if (slippage.type === 'percent') {
      slippageAmount = price.times(slippage.value).dividedBy(100);
    } else {
      slippageAmount = slippage.value;
    }

    // 买入时价格上滑，卖出时价格下滑
    return side === 'buy' ? price.plus(slippageAmount) : price.minus(slippageAmount);
  }

  /**
   * 计算手续费
   */
  private calculateCommission(amount: Decimal, price: Decimal): Decimal {
    const notional = amount.times(price);
    const commission = this.config.commission;

    if (commission.type === 'percent') {
      // 默认使用 taker 费率
      return notional.times(commission.taker).dividedBy(100);
    } else {
      return commission.taker;
    }
  }

  /**
   * 更新仓位
   */
  private updatePosition(
    order: Order,
    executionPrice: Decimal,
    commission: Decimal
  ): PositionEvent[] {
    const events: PositionEvent[] = [];
    const existingPosition = this.state.positions.get(order.symbol);

    // 计算订单金额
    const orderValue = order.amount.times(executionPrice);

    if (!existingPosition) {
      // 开新仓
      if (order.side === 'buy' || (order.side === 'sell' && this.config.allowShort)) {
        const side = order.side === 'buy' ? 'long' : 'short';

        const newPosition: BacktestPosition = {
          symbol: order.symbol,
          side,
          quantity: order.amount,
          entryPrice: executionPrice,
          entryTime: this.currentTime,
          currentPrice: executionPrice,
          unrealizedPnl: new Decimal(0),
          unrealizedPnlPercent: new Decimal(0),
        };

        this.state.positions.set(order.symbol, newPosition);

        // 扣除现金
        const cashRequired = this.config.marginEnabled
          ? orderValue.dividedBy(this.config.leverage)
          : orderValue;
        this.state.cash = this.state.cash.minus(cashRequired).minus(commission);

        events.push({
          type: EventType.POSITION_OPENED,
          timestamp: this.currentTime,
          position: newPosition,
        });
      }
    } else {
      // 现有仓位操作
      const isIncreasing =
        (existingPosition.side === 'long' && order.side === 'buy') ||
        (existingPosition.side === 'short' && order.side === 'sell');

      if (isIncreasing) {
        // 加仓：计算新的平均入场价
        const totalQuantity = existingPosition.quantity.plus(order.amount);
        const totalCost = existingPosition.entryPrice
          .times(existingPosition.quantity)
          .plus(executionPrice.times(order.amount));
        const newEntryPrice = totalCost.dividedBy(totalQuantity);

        const updatedPosition: BacktestPosition = {
          ...existingPosition,
          quantity: totalQuantity,
          entryPrice: newEntryPrice,
          currentPrice: executionPrice,
        };

        this.state.positions.set(order.symbol, updatedPosition);

        // 扣除现金
        const cashRequired = this.config.marginEnabled
          ? orderValue.dividedBy(this.config.leverage)
          : orderValue;
        this.state.cash = this.state.cash.minus(cashRequired).minus(commission);

        events.push({
          type: EventType.POSITION_UPDATED,
          timestamp: this.currentTime,
          position: updatedPosition,
        });
      } else {
        // 平仓或减仓
        const closeQuantity = Decimal.min(existingPosition.quantity, order.amount);
        const remainingQuantity = existingPosition.quantity.minus(closeQuantity);

        // 计算已实现盈亏
        const pnl =
          existingPosition.side === 'long'
            ? executionPrice.minus(existingPosition.entryPrice).times(closeQuantity)
            : existingPosition.entryPrice.minus(executionPrice).times(closeQuantity);

        const netPnl = pnl.minus(commission);

        // 记录已完成交易
        this.state.tradeCounter++;
        const closedTrade: ClosedTrade = {
          id: `TRADE-${this.state.tradeCounter}`,
          symbol: order.symbol,
          side: existingPosition.side,
          entryPrice: existingPosition.entryPrice,
          exitPrice: executionPrice,
          quantity: closeQuantity,
          entryTime: existingPosition.entryTime,
          exitTime: this.currentTime,
          holdingPeriod: this.currentTime - existingPosition.entryTime,
          pnl,
          pnlPercent: pnl.dividedBy(existingPosition.entryPrice.times(closeQuantity)).times(100),
          commission,
          netPnl,
        };

        this.state.closedTrades.push(closedTrade);

        // 返还现金 + 盈亏
        const returnValue = this.config.marginEnabled
          ? existingPosition.entryPrice.times(closeQuantity).dividedBy(this.config.leverage)
          : existingPosition.entryPrice.times(closeQuantity);
        this.state.cash = this.state.cash.plus(returnValue).plus(netPnl);

        if (remainingQuantity.isZero()) {
          // 完全平仓
          this.state.positions.delete(order.symbol);

          events.push({
            type: EventType.POSITION_CLOSED,
            timestamp: this.currentTime,
            position: existingPosition,
            realizedPnl: netPnl,
          });
        } else {
          // 部分平仓
          const updatedPosition: BacktestPosition = {
            ...existingPosition,
            quantity: remainingQuantity,
            currentPrice: executionPrice,
          };

          this.state.positions.set(order.symbol, updatedPosition);

          events.push({
            type: EventType.POSITION_UPDATED,
            timestamp: this.currentTime,
            position: updatedPosition,
            realizedPnl: netPnl,
          });
        }
      }
    }

    return events;
  }

  /**
   * 取消订单
   */
  public cancelOrder(orderId: string): OrderEvent | undefined {
    const order = this.state.pendingOrders.get(orderId);
    if (!order) {
      return undefined;
    }

    this.state.pendingOrders.delete(orderId);

    const cancelledOrder: Order = {
      ...order,
      status: 'canceled',
      lastUpdateTime: this.currentTime,
    };

    return {
      type: EventType.ORDER_CANCELLED,
      timestamp: this.currentTime,
      order: cancelledOrder,
    };
  }

  /**
   * 检查限价单是否可以成交
   * @returns 成交的订单事件数组
   */
  public checkPendingOrders(): OrderEvent[] {
    const events: OrderEvent[] = [];

    for (const order of this.state.pendingOrders.values()) {
      const currentPrice = this.currentPrices.get(order.symbol);
      if (!currentPrice) {
        continue;
      }

      let shouldFill = false;

      // 检查限价单是否触发
      if (order.type === 'limit') {
        if (order.side === 'buy' && currentPrice.lessThanOrEqualTo(order.price)) {
          shouldFill = true;
        } else if (order.side === 'sell' && currentPrice.greaterThanOrEqualTo(order.price)) {
          shouldFill = true;
        }
      }

      if (shouldFill) {
        this.state.pendingOrders.delete(order.id);
        const fillEvents = this.fillOrder(order);
        events.push(...fillEvents);
      }
    }

    return events;
  }

  /**
   * 重置经纪商状态
   */
  public reset(): void {
    this.state = {
      cash: this.config.initialCapital,
      positions: new Map(),
      pendingOrders: new Map(),
      closedTrades: [],
      orderCounter: 0,
      tradeCounter: 0,
    };
    this.currentPrices.clear();
    this.currentTime = 0;
  }
}
