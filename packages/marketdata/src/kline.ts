// ============================================================================
// K 线管理器
// 维护 K 线数据，支持历史数据和实时更新
// ============================================================================

import type Decimal from 'decimal.js';
import { LRUCache } from 'lru-cache';

import type { ExchangeId, Symbol } from '@quant/exchange';

import type { Kline, KlineInterval } from './types';

// ============================================================================
// K 线序列
// ============================================================================

/**
 * K 线序列类
 * 存储单个交易对、单个周期的 K 线数据
 */
class KlineSeries {
  public readonly symbol: Symbol;
  public readonly exchangeId: ExchangeId;
  public readonly interval: KlineInterval;

  // K 线数据存储（按时间戳索引）
  private readonly data: Map<number, Kline> = new Map();

  // 最大存储数量
  private readonly maxSize: number;

  // 最新 K 线
  private _latest: Kline | null = null;

  public constructor(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval,
    maxSize: number = 1000
  ) {
    this.symbol = symbol;
    this.exchangeId = exchangeId;
    this.interval = interval;
    this.maxSize = maxSize;
  }

  /**
   * 获取最新 K 线
   */
  public get latest(): Kline | null {
    return this._latest;
  }

  /**
   * 获取 K 线数量
   */
  public get size(): number {
    return this.data.size;
  }

  /**
   * 添加或更新 K 线
   */
  public update(kline: Kline): void {
    // 使用开盘时间作为键
    this.data.set(kline.openTime, kline);

    // 更新最新 K 线
    if (!this._latest || kline.openTime >= this._latest.openTime) {
      this._latest = kline;
    }

    // 如果超出最大数量，删除最旧的
    if (this.data.size > this.maxSize) {
      const oldestTime = Math.min(...this.data.keys());
      this.data.delete(oldestTime);
    }
  }

  /**
   * 批量添加 K 线（历史数据）
   */
  public addBatch(klines: Kline[]): void {
    for (const kline of klines) {
      this.data.set(kline.openTime, kline);
    }

    // 清理超出的数据
    while (this.data.size > this.maxSize) {
      const oldestTime = Math.min(...this.data.keys());
      this.data.delete(oldestTime);
    }

    // 更新最新 K 线
    const times = [...this.data.keys()].sort((a, b) => b - a);
    if (times.length > 0) {
      this._latest = this.data.get(times[0]) ?? null;
    }
  }

  /**
   * 获取指定时间的 K 线
   */
  public get(openTime: number): Kline | undefined {
    return this.data.get(openTime);
  }

  /**
   * 获取时间范围内的 K 线
   */
  public getRange(startTime: number, endTime: number): Kline[] {
    const result: Kline[] = [];

    for (const [time, kline] of this.data) {
      if (time >= startTime && time <= endTime) {
        result.push(kline);
      }
    }

    // 按时间升序排列
    return result.sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * 获取最近 N 根 K 线
   */
  public getLast(count: number): Kline[] {
    const sorted = [...this.data.values()].sort((a, b) => b.openTime - a.openTime);
    return sorted.slice(0, count).reverse();
  }

  /**
   * 获取所有 K 线（按时间升序）
   */
  public getAll(): Kline[] {
    return [...this.data.values()].sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * 清空数据
   */
  public clear(): void {
    this.data.clear();
    this._latest = null;
  }

  /**
   * 计算技术指标所需的数据
   * 返回 OHLCV 数组格式
   */
  public toOHLCV(): {
    opens: Decimal[];
    highs: Decimal[];
    lows: Decimal[];
    closes: Decimal[];
    volumes: Decimal[];
    timestamps: number[];
  } {
    const klines = this.getAll();

    return {
      opens: klines.map(k => k.open),
      highs: klines.map(k => k.high),
      lows: klines.map(k => k.low),
      closes: klines.map(k => k.close),
      volumes: klines.map(k => k.volume),
      timestamps: klines.map(k => k.openTime),
    };
  }
}

// ============================================================================
// K 线管理器
// ============================================================================

/**
 * K 线管理器
 *
 * 功能：
 * - 管理多个交易对、多个周期的 K 线数据
 * - 支持历史数据加载和实时更新
 * - 使用 LRU 缓存限制内存使用
 */
export class KlineManager {
  // K 线序列存储
  private readonly series: LRUCache<string, KlineSeries>;

  // 每个序列的最大 K 线数量
  private readonly maxKlinesPerSeries: number;

  /**
   * 构造函数
   * @param maxSeries - 最大缓存的序列数量
   * @param maxKlinesPerSeries - 每个序列的最大 K 线数量
   */
  public constructor(maxSeries: number = 500, maxKlinesPerSeries: number = 1000) {
    this.maxKlinesPerSeries = maxKlinesPerSeries;

    this.series = new LRUCache<string, KlineSeries>({
      max: maxSeries,
    });
  }

  /**
   * 生成序列键
   */
  private getKey(symbol: Symbol, exchangeId: ExchangeId, interval: KlineInterval): string {
    return `${exchangeId}:${symbol}:${interval}`;
  }

  /**
   * 获取或创建 K 线序列
   */
  private getOrCreate(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval
  ): KlineSeries {
    const key = this.getKey(symbol, exchangeId, interval);
    let klineSeries = this.series.get(key);

    if (!klineSeries) {
      klineSeries = new KlineSeries(symbol, exchangeId, interval, this.maxKlinesPerSeries);
      this.series.set(key, klineSeries);
    }

    return klineSeries;
  }

  /**
   * 更新 K 线
   * 用于处理实时 WebSocket 推送
   */
  public update(kline: Kline): void {
    const klineSeries = this.getOrCreate(kline.symbol, kline.exchangeId, kline.interval);
    klineSeries.update(kline);
  }

  /**
   * 批量添加 K 线
   * 用于加载历史数据
   */
  public addBatch(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval,
    klines: Kline[]
  ): void {
    const klineSeries = this.getOrCreate(symbol, exchangeId, interval);
    klineSeries.addBatch(klines);
  }

  /**
   * 获取 K 线序列
   */
  public getSeries(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval
  ): KlineSeries | undefined {
    const key = this.getKey(symbol, exchangeId, interval);
    return this.series.get(key);
  }

  /**
   * 获取最新 K 线
   */
  public getLatest(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval
  ): Kline | null {
    const klineSeries = this.getSeries(symbol, exchangeId, interval);
    return klineSeries?.latest ?? null;
  }

  /**
   * 获取最近 N 根 K 线
   */
  public getLast(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval,
    count: number
  ): Kline[] {
    const klineSeries = this.getSeries(symbol, exchangeId, interval);
    return klineSeries?.getLast(count) ?? [];
  }

  /**
   * 获取时间范围内的 K 线
   */
  public getRange(
    symbol: Symbol,
    exchangeId: ExchangeId,
    interval: KlineInterval,
    startTime: number,
    endTime: number
  ): Kline[] {
    const klineSeries = this.getSeries(symbol, exchangeId, interval);
    return klineSeries?.getRange(startTime, endTime) ?? [];
  }

  /**
   * 检查序列是否存在
   */
  public has(symbol: Symbol, exchangeId: ExchangeId, interval: KlineInterval): boolean {
    const key = this.getKey(symbol, exchangeId, interval);
    return this.series.has(key);
  }

  /**
   * 删除 K 线序列
   */
  public delete(symbol: Symbol, exchangeId: ExchangeId, interval: KlineInterval): boolean {
    const key = this.getKey(symbol, exchangeId, interval);
    return this.series.delete(key);
  }

  /**
   * 清空所有数据
   */
  public clear(): void {
    this.series.clear();
  }

  /**
   * 获取当前缓存的序列数量
   */
  public get size(): number {
    return this.series.size;
  }
}
