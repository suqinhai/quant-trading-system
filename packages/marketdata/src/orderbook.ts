// ============================================================================
// 订单簿管理器
// 维护订单簿状态，支持快照和增量更新
// ============================================================================

import Decimal from 'decimal.js';
import { LRUCache } from 'lru-cache';

import type { ExchangeId, Symbol } from '@quant/exchange';

import type { OrderBook, OrderBookUpdate, PriceLevel } from './types.js';

// ============================================================================
// 订单簿实现
// ============================================================================

/**
 * 可变订单簿类
 * 内部使用，支持增量更新
 */
class MutableOrderBook implements OrderBook {
  public readonly symbol: Symbol;
  public readonly exchangeId: ExchangeId;

  // 使用 Map 存储价格档位，便于快速更新
  private _bids: Map<string, PriceLevel> = new Map();
  private _asks: Map<string, PriceLevel> = new Map();

  // 缓存排序后的数组
  private _sortedBids: PriceLevel[] | null = null;
  private _sortedAsks: PriceLevel[] | null = null;

  public timestamp: number = 0;
  public sequence?: number;

  public constructor(symbol: Symbol, exchangeId: ExchangeId) {
    this.symbol = symbol;
    this.exchangeId = exchangeId;
  }

  /**
   * 获取买盘（按价格降序）
   */
  public get bids(): readonly PriceLevel[] {
    if (!this._sortedBids) {
      this._sortedBids = Array.from(this._bids.values()).sort((a, b) =>
        b.price.comparedTo(a.price)
      );
    }
    return this._sortedBids;
  }

  /**
   * 获取卖盘（按价格升序）
   */
  public get asks(): readonly PriceLevel[] {
    if (!this._sortedAsks) {
      this._sortedAsks = Array.from(this._asks.values()).sort((a, b) =>
        a.price.comparedTo(b.price)
      );
    }
    return this._sortedAsks;
  }

  /**
   * 获取最优买价
   */
  public get bestBid(): PriceLevel | undefined {
    return this.bids[0];
  }

  /**
   * 获取最优卖价
   */
  public get bestAsk(): PriceLevel | undefined {
    return this.asks[0];
  }

  /**
   * 获取买卖价差
   */
  public get spread(): Decimal | undefined {
    const bid = this.bestBid;
    const ask = this.bestAsk;
    if (bid && ask) {
      return ask.price.minus(bid.price);
    }
    return undefined;
  }

  /**
   * 获取中间价
   */
  public get midPrice(): Decimal | undefined {
    const bid = this.bestBid;
    const ask = this.bestAsk;
    if (bid && ask) {
      return bid.price.plus(ask.price).dividedBy(2);
    }
    return undefined;
  }

  /**
   * 应用快照更新
   * 完全替换当前订单簿
   */
  public applySnapshot(update: OrderBookUpdate): void {
    // 清空现有数据
    this._bids.clear();
    this._asks.clear();

    // 添加新数据
    for (const level of update.bids) {
      this._bids.set(level.price.toString(), level);
    }
    for (const level of update.asks) {
      this._asks.set(level.price.toString(), level);
    }

    // 更新元数据
    this.timestamp = update.timestamp;
    this.sequence = update.lastUpdateId;

    // 清除缓存
    this._sortedBids = null;
    this._sortedAsks = null;
  }

  /**
   * 应用增量更新
   */
  public applyDelta(update: OrderBookUpdate): void {
    // 更新买盘
    for (const level of update.bids) {
      const priceKey = level.price.toString();
      if (level.amount.isZero()) {
        // 数量为 0 表示删除该价格档位
        this._bids.delete(priceKey);
      } else {
        // 更新或添加价格档位
        this._bids.set(priceKey, level);
      }
    }

    // 更新卖盘
    for (const level of update.asks) {
      const priceKey = level.price.toString();
      if (level.amount.isZero()) {
        this._asks.delete(priceKey);
      } else {
        this._asks.set(priceKey, level);
      }
    }

    // 更新元数据
    this.timestamp = update.timestamp;
    this.sequence = update.lastUpdateId;

    // 清除缓存
    this._sortedBids = null;
    this._sortedAsks = null;
  }

  /**
   * 获取指定深度的订单簿
   */
  public getDepth(depth: number): OrderBook {
    return {
      symbol: this.symbol,
      exchangeId: this.exchangeId,
      bids: this.bids.slice(0, depth),
      asks: this.asks.slice(0, depth),
      timestamp: this.timestamp,
      sequence: this.sequence,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      spread: this.spread,
      midPrice: this.midPrice,
    };
  }

  /**
   * 创建只读快照
   */
  public snapshot(): OrderBook {
    return {
      symbol: this.symbol,
      exchangeId: this.exchangeId,
      bids: [...this.bids],
      asks: [...this.asks],
      timestamp: this.timestamp,
      sequence: this.sequence,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      spread: this.spread,
      midPrice: this.midPrice,
    };
  }
}

// ============================================================================
// 订单簿管理器
// ============================================================================

/**
 * 订单簿管理器
 *
 * 功能：
 * - 维护多个交易对的订单簿状态
 * - 支持快照和增量更新
 * - 使用 LRU 缓存限制内存使用
 * - 线程安全的读写操作
 */
export class OrderBookManager {
  // 订单簿存储
  private readonly orderBooks: LRUCache<string, MutableOrderBook>;

  // 最大缓存数量
  private readonly maxSize: number;

  /**
   * 构造函数
   * @param maxSize - 最大缓存的订单簿数量
   */
  public constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;

    // 初始化 LRU 缓存
    this.orderBooks = new LRUCache<string, MutableOrderBook>({
      max: maxSize,
      // 当缓存项被移除时的回调
      dispose: (value, key) => {
        // 可以在这里记录日志或清理资源
      },
    });
  }

  /**
   * 生成订单簿键
   */
  private getKey(symbol: Symbol, exchangeId: ExchangeId): string {
    return `${exchangeId}:${symbol}`;
  }

  /**
   * 获取或创建订单簿
   */
  private getOrCreate(symbol: Symbol, exchangeId: ExchangeId): MutableOrderBook {
    const key = this.getKey(symbol, exchangeId);
    let orderBook = this.orderBooks.get(key);

    if (!orderBook) {
      orderBook = new MutableOrderBook(symbol, exchangeId);
      this.orderBooks.set(key, orderBook);
    }

    return orderBook;
  }

  /**
   * 处理订单簿更新
   * 自动识别快照和增量更新
   */
  public handleUpdate(update: OrderBookUpdate): OrderBook {
    const orderBook = this.getOrCreate(update.symbol, update.exchangeId);

    if (update.type === 'snapshot') {
      // 应用快照
      orderBook.applySnapshot(update);
    } else {
      // 应用增量更新
      orderBook.applyDelta(update);
    }

    return orderBook.snapshot();
  }

  /**
   * 获取订单簿
   * @param symbol - 交易对符号
   * @param exchangeId - 交易所标识
   * @returns 订单簿快照，如果不存在则返回 undefined
   */
  public get(symbol: Symbol, exchangeId: ExchangeId): OrderBook | undefined {
    const key = this.getKey(symbol, exchangeId);
    const orderBook = this.orderBooks.get(key);
    return orderBook?.snapshot();
  }

  /**
   * 获取指定深度的订单簿
   */
  public getWithDepth(
    symbol: Symbol,
    exchangeId: ExchangeId,
    depth: number
  ): OrderBook | undefined {
    const key = this.getKey(symbol, exchangeId);
    const orderBook = this.orderBooks.get(key);
    return orderBook?.getDepth(depth);
  }

  /**
   * 检查订单簿是否存在
   */
  public has(symbol: Symbol, exchangeId: ExchangeId): boolean {
    const key = this.getKey(symbol, exchangeId);
    return this.orderBooks.has(key);
  }

  /**
   * 删除订单簿
   */
  public delete(symbol: Symbol, exchangeId: ExchangeId): boolean {
    const key = this.getKey(symbol, exchangeId);
    return this.orderBooks.delete(key);
  }

  /**
   * 清空所有订单簿
   */
  public clear(): void {
    this.orderBooks.clear();
  }

  /**
   * 获取当前缓存的订单簿数量
   */
  public get size(): number {
    return this.orderBooks.size;
  }

  /**
   * 获取所有订单簿的键
   */
  public keys(): string[] {
    return [...this.orderBooks.keys()];
  }
}
