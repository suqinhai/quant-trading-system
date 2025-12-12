// ============================================================================
// 订单簿模拟器
// 维护买卖盘深度，支持动态滑点计算
// 提供基于深度的成交价格模拟
// ============================================================================

import {
  type ExchangeId,
  type DepthEvent,
  type PriceLevel,
  type OrderSide,
  type SlippageConfig,
  type SlippageModelType,
  DEFAULT_SLIPPAGE_CONFIG,
  getPositionKey,
} from './types';

// ============================================================================
// 订单簿类型定义
// ============================================================================

// 滑点计算结果
export interface SlippageResult {
  // 预期成交价格
  expectedPrice: number;
  // 滑点金额
  slippageAmount: number;
  // 滑点百分比
  slippagePercent: number;
  // 是否可以完全成交
  canFill: boolean;
  // 最大可成交数量
  maxFillQuantity: number;
  // 成交明细（各价格档位的成交情况）
  fills: PriceLevelFill[];
}

// 价格档位成交明细
export interface PriceLevelFill {
  // 价格
  price: number;
  // 成交数量
  quantity: number;
  // 累计成交额
  notional: number;
}

// 订单簿快照
export interface OrderBookSnapshot {
  // 交易所
  exchange: ExchangeId;
  // 交易对
  symbol: string;
  // 时间戳
  timestamp: number;
  // 买盘（按价格从高到低）
  bids: PriceLevel[];
  // 卖盘（按价格从低到高）
  asks: PriceLevel[];
  // 中间价
  midPrice: number;
  // 买一价
  bestBid: number;
  // 卖一价
  bestAsk: number;
  // 买卖价差
  spread: number;
  // 价差百分比
  spreadPercent: number;
}

// ============================================================================
// 订单簿类
// ============================================================================

/**
 * 订单簿
 * 维护单个交易对的买卖盘深度数据
 */
export class OrderBook {
  // 交易所 ID
  readonly exchange: ExchangeId;

  // 交易对符号
  readonly symbol: string;

  // 买盘（按价格从高到低排序）
  private _bids: PriceLevel[] = [];

  // 卖盘（按价格从低到高排序）
  private _asks: PriceLevel[] = [];

  // 最后更新时间戳
  private _lastUpdateTime: number = 0;

  // 滑点配置
  private slippageConfig: SlippageConfig;

  /**
   * 构造函数
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param slippageConfig - 滑点配置（可选）
   */
  constructor(
    exchange: ExchangeId,
    symbol: string,
    slippageConfig?: SlippageConfig
  ) {
    // 保存交易所和交易对
    this.exchange = exchange;
    this.symbol = symbol;

    // 使用提供的配置或默认配置
    this.slippageConfig = slippageConfig ?? DEFAULT_SLIPPAGE_CONFIG;
  }

  // ========================================================================
  // 属性访问器
  // ========================================================================

  /**
   * 获取买盘
   */
  get bids(): readonly PriceLevel[] {
    return this._bids;
  }

  /**
   * 获取卖盘
   */
  get asks(): readonly PriceLevel[] {
    return this._asks;
  }

  /**
   * 获取最后更新时间
   */
  get lastUpdateTime(): number {
    return this._lastUpdateTime;
  }

  /**
   * 获取买一价
   */
  get bestBid(): number {
    // 返回买盘第一档价格，无数据返回 0
    return this._bids.length > 0 ? this._bids[0]!.price : 0;
  }

  /**
   * 获取卖一价
   */
  get bestAsk(): number {
    // 返回卖盘第一档价格，无数据返回 Infinity
    return this._asks.length > 0 ? this._asks[0]!.price : Infinity;
  }

  /**
   * 获取中间价
   */
  get midPrice(): number {
    // 如果任一方向无数据，返回 0
    if (this._bids.length === 0 || this._asks.length === 0) {
      return 0;
    }

    // 返回买一卖一的中间价
    return (this.bestBid + this.bestAsk) / 2;
  }

  /**
   * 获取买卖价差
   */
  get spread(): number {
    // 返回卖一减买一
    return this.bestAsk - this.bestBid;
  }

  /**
   * 获取价差百分比
   */
  get spreadPercent(): number {
    // 避免除零
    if (this.midPrice === 0) return 0;

    // 返回价差相对于中间价的百分比
    return this.spread / this.midPrice;
  }

  // ========================================================================
  // 数据更新
  // ========================================================================

  /**
   * 更新订单簿（从深度事件）
   * @param depth - 深度事件
   */
  update(depth: DepthEvent): void {
    // 验证交易所和交易对
    if (depth.exchange !== this.exchange || depth.symbol !== this.symbol) {
      // 不匹配则忽略
      return;
    }

    // 更新买盘（已按价格从高到低排序）
    this._bids = [...depth.bids];

    // 更新卖盘（已按价格从低到高排序）
    this._asks = [...depth.asks];

    // 更新时间戳
    this._lastUpdateTime = depth.timestamp;
  }

  /**
   * 直接设置订单簿数据
   * @param bids - 买盘数据
   * @param asks - 卖盘数据
   * @param timestamp - 时间戳
   */
  setDepth(bids: PriceLevel[], asks: PriceLevel[], timestamp: number): void {
    // 设置买盘
    this._bids = bids;
    // 设置卖盘
    this._asks = asks;
    // 设置时间戳
    this._lastUpdateTime = timestamp;
  }

  /**
   * 清空订单簿
   */
  clear(): void {
    this._bids = [];
    this._asks = [];
    this._lastUpdateTime = 0;
  }

  // ========================================================================
  // 滑点计算
  // ========================================================================

  /**
   * 计算市价单滑点
   * @param side - 订单方向
   * @param quantity - 订单数量
   * @param referencePrice - 参考价格（可选，默认使用中间价）
   * @returns 滑点计算结果
   */
  calculateSlippage(
    side: OrderSide,
    quantity: number,
    referencePrice?: number
  ): SlippageResult {
    // 使用中间价作为参考价格
    const refPrice = referencePrice ?? this.midPrice;

    // 根据滑点模型类型计算
    switch (this.slippageConfig.type) {
      case 'fixed':
        // 固定滑点模型
        return this.calculateFixedSlippage(side, quantity, refPrice);

      case 'linear':
        // 线性滑点模型
        return this.calculateLinearSlippage(side, quantity, refPrice);

      case 'sqrt':
        // 平方根滑点模型
        return this.calculateSqrtSlippage(side, quantity, refPrice);

      case 'dynamic':
      default:
        // 动态深度滑点模型（默认）
        return this.calculateDynamicSlippage(side, quantity, refPrice);
    }
  }

  /**
   * 固定滑点模型
   * 无论订单大小，滑点固定为配置值
   */
  private calculateFixedSlippage(
    side: OrderSide,
    quantity: number,
    refPrice: number
  ): SlippageResult {
    // 获取固定滑点（基点，1 bps = 0.0001）
    const slippageBps = this.slippageConfig.fixedSlippage ?? 5; // 默认 5 bps
    const slippagePercent = slippageBps / 10000;

    // 计算滑点金额
    const slippageAmount = refPrice * slippagePercent;

    // 计算预期价格（买入价格上升，卖出价格下降）
    const expectedPrice = side === 'buy'
      ? refPrice + slippageAmount
      : refPrice - slippageAmount;

    // 返回结果
    return {
      expectedPrice,
      slippageAmount,
      slippagePercent,
      canFill: true, // 固定滑点假设总是可以成交
      maxFillQuantity: quantity,
      fills: [{
        price: expectedPrice,
        quantity,
        notional: expectedPrice * quantity,
      }],
    };
  }

  /**
   * 线性滑点模型
   * 滑点与订单数量成正比
   */
  private calculateLinearSlippage(
    side: OrderSide,
    quantity: number,
    refPrice: number
  ): SlippageResult {
    // 获取线性系数（每单位数量的滑点百分比）
    const coefficient = this.slippageConfig.linearCoefficient ?? 0.0001;

    // 计算滑点百分比
    let slippagePercent = coefficient * quantity;

    // 应用最大滑点限制
    const maxSlippage = this.slippageConfig.maxSlippage ?? 0.01;
    slippagePercent = Math.min(slippagePercent, maxSlippage);

    // 计算滑点金额
    const slippageAmount = refPrice * slippagePercent;

    // 计算预期价格
    const expectedPrice = side === 'buy'
      ? refPrice + slippageAmount
      : refPrice - slippageAmount;

    // 返回结果
    return {
      expectedPrice,
      slippageAmount,
      slippagePercent,
      canFill: true,
      maxFillQuantity: quantity,
      fills: [{
        price: expectedPrice,
        quantity,
        notional: expectedPrice * quantity,
      }],
    };
  }

  /**
   * 平方根滑点模型
   * 滑点与订单数量的平方根成正比（模拟市场冲击）
   */
  private calculateSqrtSlippage(
    side: OrderSide,
    quantity: number,
    refPrice: number
  ): SlippageResult {
    // 获取平方根系数
    const coefficient = this.slippageConfig.sqrtCoefficient ?? 0.001;

    // 计算滑点百分比（使用平方根）
    let slippagePercent = coefficient * Math.sqrt(quantity);

    // 应用最大滑点限制
    const maxSlippage = this.slippageConfig.maxSlippage ?? 0.01;
    slippagePercent = Math.min(slippagePercent, maxSlippage);

    // 计算滑点金额
    const slippageAmount = refPrice * slippagePercent;

    // 计算预期价格
    const expectedPrice = side === 'buy'
      ? refPrice + slippageAmount
      : refPrice - slippageAmount;

    // 返回结果
    return {
      expectedPrice,
      slippageAmount,
      slippagePercent,
      canFill: true,
      maxFillQuantity: quantity,
      fills: [{
        price: expectedPrice,
        quantity,
        notional: expectedPrice * quantity,
      }],
    };
  }

  /**
   * 动态深度滑点模型（最精确）
   * 基于实际订单簿深度计算滑点
   */
  private calculateDynamicSlippage(
    side: OrderSide,
    quantity: number,
    refPrice: number
  ): SlippageResult {
    // 选择对应方向的订单簿
    // 买入吃卖盘，卖出吃买盘
    const levels = side === 'buy' ? this._asks : this._bids;

    // 如果订单簿为空，回退到固定滑点
    if (levels.length === 0) {
      return this.calculateFixedSlippage(side, quantity, refPrice);
    }

    // 成交明细
    const fills: PriceLevelFill[] = [];

    // 剩余需要成交的数量
    let remainingQuantity = quantity;

    // 累计成交额
    let totalNotional = 0;

    // 累计成交量
    let totalQuantity = 0;

    // 遍历订单簿档位
    for (const level of levels) {
      // 如果已经全部成交，退出
      if (remainingQuantity <= 0) {
        break;
      }

      // 当前档位可成交数量
      const fillQuantity = Math.min(remainingQuantity, level.quantity);

      // 当前档位成交额
      const fillNotional = fillQuantity * level.price;

      // 记录成交明细
      fills.push({
        price: level.price,
        quantity: fillQuantity,
        notional: fillNotional,
      });

      // 更新累计值
      totalNotional += fillNotional;
      totalQuantity += fillQuantity;
      remainingQuantity -= fillQuantity;
    }

    // 计算是否可以完全成交
    const canFill = remainingQuantity <= 0;

    // 计算平均成交价格
    const expectedPrice = totalQuantity > 0
      ? totalNotional / totalQuantity
      : refPrice;

    // 计算滑点
    const slippageAmount = Math.abs(expectedPrice - refPrice);
    let slippagePercent = refPrice > 0 ? slippageAmount / refPrice : 0;

    // 应用最大滑点限制
    const maxSlippage = this.slippageConfig.maxSlippage ?? 0.01;
    if (slippagePercent > maxSlippage) {
      // 限制滑点
      slippagePercent = maxSlippage;

      // 重新计算价格
      const limitedSlippageAmount = refPrice * maxSlippage;
      const limitedPrice = side === 'buy'
        ? refPrice + limitedSlippageAmount
        : refPrice - limitedSlippageAmount;

      // 返回限制后的结果
      return {
        expectedPrice: limitedPrice,
        slippageAmount: limitedSlippageAmount,
        slippagePercent,
        canFill,
        maxFillQuantity: totalQuantity,
        fills,
      };
    }

    // 返回结果
    return {
      expectedPrice,
      slippageAmount,
      slippagePercent,
      canFill,
      maxFillQuantity: totalQuantity,
      fills,
    };
  }

  /**
   * 获取指定数量的成交价格
   * @param side - 订单方向
   * @param quantity - 订单数量
   * @returns 成交价格
   */
  getExecutionPrice(side: OrderSide, quantity: number): number {
    // 计算滑点
    const result = this.calculateSlippage(side, quantity);
    // 返回预期成交价格
    return result.expectedPrice;
  }

  /**
   * 检查限价单是否可以立即成交
   * @param side - 订单方向
   * @param price - 限价
   * @returns 是否可以立即成交
   */
  canFillImmediately(side: OrderSide, price: number): boolean {
    // 买单：限价 >= 卖一价时可立即成交
    if (side === 'buy') {
      return price >= this.bestAsk;
    }

    // 卖单：限价 <= 买一价时可立即成交
    return price <= this.bestBid;
  }

  /**
   * 获取限价单可成交数量
   * @param side - 订单方向
   * @param price - 限价
   * @param maxQuantity - 最大数量
   * @returns 可成交数量
   */
  getFillableQuantity(
    side: OrderSide,
    price: number,
    maxQuantity: number
  ): number {
    // 选择对应方向的订单簿
    const levels = side === 'buy' ? this._asks : this._bids;

    // 累计可成交数量
    let fillableQuantity = 0;

    // 遍历订单簿
    for (const level of levels) {
      // 检查价格是否满足条件
      if (side === 'buy' && level.price > price) {
        // 买单：价格超过限价，停止
        break;
      }

      if (side === 'sell' && level.price < price) {
        // 卖单：价格低于限价，停止
        break;
      }

      // 累加可成交数量
      fillableQuantity += level.quantity;

      // 检查是否已达到最大数量
      if (fillableQuantity >= maxQuantity) {
        return maxQuantity;
      }
    }

    return fillableQuantity;
  }

  // ========================================================================
  // 快照和序列化
  // ========================================================================

  /**
   * 获取订单簿快照
   */
  getSnapshot(): OrderBookSnapshot {
    return {
      exchange: this.exchange,
      symbol: this.symbol,
      timestamp: this._lastUpdateTime,
      bids: [...this._bids],
      asks: [...this._asks],
      midPrice: this.midPrice,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      spread: this.spread,
      spreadPercent: this.spreadPercent,
    };
  }
}

// ============================================================================
// 订单簿管理器
// ============================================================================

/**
 * 订单簿管理器
 * 管理多个交易对的订单簿
 */
export class OrderBookManager {
  // 订单簿映射（按 exchange:symbol 索引）
  private orderBooks: Map<string, OrderBook> = new Map();

  // 默认滑点配置
  private defaultSlippageConfig: SlippageConfig;

  /**
   * 构造函数
   * @param slippageConfig - 默认滑点配置
   */
  constructor(slippageConfig?: SlippageConfig) {
    // 使用提供的配置或默认配置
    this.defaultSlippageConfig = slippageConfig ?? DEFAULT_SLIPPAGE_CONFIG;
  }

  /**
   * 获取或创建订单簿
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  getOrCreate(exchange: ExchangeId, symbol: string): OrderBook {
    // 生成键
    const key = getPositionKey(exchange, symbol);

    // 检查是否存在
    let orderBook = this.orderBooks.get(key);

    // 不存在则创建
    if (!orderBook) {
      orderBook = new OrderBook(exchange, symbol, this.defaultSlippageConfig);
      this.orderBooks.set(key, orderBook);
    }

    return orderBook;
  }

  /**
   * 获取订单簿（可能为空）
   * @param exchange - 交易所
   * @param symbol - 交易对
   */
  get(exchange: ExchangeId, symbol: string): OrderBook | undefined {
    const key = getPositionKey(exchange, symbol);
    return this.orderBooks.get(key);
  }

  /**
   * 更新订单簿
   * @param depth - 深度事件
   */
  update(depth: DepthEvent): void {
    // 获取或创建订单簿
    const orderBook = this.getOrCreate(depth.exchange, depth.symbol);
    // 更新数据
    orderBook.update(depth);
  }

  /**
   * 计算滑点
   * @param exchange - 交易所
   * @param symbol - 交易对
   * @param side - 订单方向
   * @param quantity - 订单数量
   * @param referencePrice - 参考价格（可选）
   */
  calculateSlippage(
    exchange: ExchangeId,
    symbol: string,
    side: OrderSide,
    quantity: number,
    referencePrice?: number
  ): SlippageResult {
    // 获取订单簿
    const orderBook = this.get(exchange, symbol);

    // 如果不存在，返回默认结果
    if (!orderBook) {
      return {
        expectedPrice: referencePrice ?? 0,
        slippageAmount: 0,
        slippagePercent: 0,
        canFill: false,
        maxFillQuantity: 0,
        fills: [],
      };
    }

    // 计算滑点
    return orderBook.calculateSlippage(side, quantity, referencePrice);
  }

  /**
   * 获取所有订单簿
   */
  getAll(): OrderBook[] {
    return Array.from(this.orderBooks.values());
  }

  /**
   * 获取订单簿数量
   */
  get size(): number {
    return this.orderBooks.size;
  }

  /**
   * 清空所有订单簿
   */
  clear(): void {
    // 清空每个订单簿
    for (const orderBook of this.orderBooks.values()) {
      orderBook.clear();
    }
    // 清空映射
    this.orderBooks.clear();
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建订单簿管理器
 * @param slippageConfig - 滑点配置
 */
export function createOrderBookManager(slippageConfig?: SlippageConfig): OrderBookManager {
  return new OrderBookManager(slippageConfig);
}
