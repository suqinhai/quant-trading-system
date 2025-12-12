// ============================================================================
// Redis 客户端封装
// 提供 TimeSeries 写入和 Pub/Sub 发布功能
// 使用批量写入优化性能
// ============================================================================

import Redis from 'ioredis';

import {
  type RedisConfig,
  type TimeSeriesRetention,
  type UnifiedMarketData,
  DEFAULT_CONFIG,
} from './types';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 待写入的 TimeSeries 数据项
 */
interface TimeSeriesItem {
  // 键名
  key: string;
  // 时间戳（毫秒）
  timestamp: number;
  // 值
  value: number;
  // 标签（用于过滤）
  labels?: Record<string, string>;
}

/**
 * 批量写入缓冲区
 */
interface BatchBuffer {
  // TimeSeries 数据
  timeSeries: TimeSeriesItem[];
  // Pub/Sub 消息
  pubSub: string[];
}

// ============================================================================
// Redis 客户端
// ============================================================================

/**
 * Redis 客户端
 *
 * 功能：
 * - 连接池管理
 * - TimeSeries 批量写入
 * - Pub/Sub 发布
 * - 性能优化（批量操作、Pipeline）
 */
export class RedisClient {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 主 Redis 客户端（用于命令）
  private client: Redis;

  // 发布专用客户端（避免阻塞）
  private publisher: Redis;

  // 配置
  private readonly config: RedisConfig;

  // 保留配置
  private readonly retention: TimeSeriesRetention;

  // 批量写入缓冲区
  private buffer: BatchBuffer = {
    timeSeries: [],
    pubSub: [],
  };

  // 批量写入定时器
  private batchTimer: NodeJS.Timeout | null = null;

  // 批量写入间隔
  private readonly batchInterval: number;

  // 批量写入大小
  private readonly batchSize: number;

  // Pub/Sub 频道名
  private readonly pubSubChannel: string;

  // 是否启用 TimeSeries
  private readonly enableTimeSeries: boolean;

  // 是否启用 Pub/Sub
  private readonly enablePubSub: boolean;

  // 统计
  private stats = {
    timeSeriesWrites: 0,
    pubSubPublishes: 0,
    errors: 0,
  };

  // 是否已初始化 TimeSeries
  private timeSeriesInitialized: Set<string> = new Set();

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - Redis 配置
   * @param options - 其他选项
   */
  constructor(
    config: RedisConfig,
    options: {
      retention?: TimeSeriesRetention;
      batchInterval?: number;
      batchSize?: number;
      pubSubChannel?: string;
      enableTimeSeries?: boolean;
      enablePubSub?: boolean;
    } = {}
  ) {
    // 保存配置
    this.config = config;
    this.retention = options.retention ?? DEFAULT_CONFIG.retention;
    this.batchInterval = options.batchInterval ?? DEFAULT_CONFIG.batchInterval;
    this.batchSize = options.batchSize ?? DEFAULT_CONFIG.batchSize;
    this.pubSubChannel = options.pubSubChannel ?? DEFAULT_CONFIG.pubSubChannel;
    this.enableTimeSeries = options.enableTimeSeries ?? DEFAULT_CONFIG.enableTimeSeries;
    this.enablePubSub = options.enablePubSub ?? DEFAULT_CONFIG.enablePubSub;

    // 创建 Redis 连接配置
    const redisOptions = {
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      // 键前缀
      keyPrefix: config.keyPrefix ?? 'mkt:',
      // 启用离线队列
      enableOfflineQueue: true,
      // 连接超时
      connectTimeout: 10000,
      // 命令超时
      commandTimeout: 5000,
      // 自动重连
      retryStrategy: (times: number) => {
        // 指数退避，最大 30 秒
        return Math.min(times * 1000, 30000);
      },
      // 启用就绪检查
      enableReadyCheck: true,
      // 最大重试次数
      maxRetriesPerRequest: 3,
    };

    // 创建主客户端
    this.client = new Redis(redisOptions);

    // 创建发布专用客户端（独立连接避免阻塞）
    this.publisher = new Redis(redisOptions);

    // 启动批量写入定时器
    this.startBatchTimer();
  }

  // ========================================================================
  // 连接管理
  // ========================================================================

  /**
   * 等待连接就绪
   */
  async waitForReady(): Promise<void> {
    // 等待两个客户端都就绪
    await Promise.all([
      this.waitClientReady(this.client),
      this.waitClientReady(this.publisher),
    ]);
  }

  /**
   * 等待单个客户端就绪
   */
  private waitClientReady(client: Redis): Promise<void> {
    return new Promise((resolve, reject) => {
      // 如果已就绪，直接返回
      if (client.status === 'ready') {
        resolve();
        return;
      }

      // 监听就绪事件
      client.once('ready', () => {
        resolve();
      });

      // 监听错误事件
      client.once('error', (error: Error) => {
        reject(error);
      });

      // 超时
      setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);
    });
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    // 停止批量写入定时器
    this.stopBatchTimer();

    // 刷新剩余数据
    await this.flush();

    // 关闭连接
    await Promise.all([
      this.client.quit(),
      this.publisher.quit(),
    ]);
  }

  // ========================================================================
  // TimeSeries 操作
  // ========================================================================

  /**
   * 确保 TimeSeries 键已创建
   * @param key - 键名
   * @param retention - 保留时间（毫秒）
   * @param labels - 标签
   */
  private async ensureTimeSeries(
    key: string,
    retention: number,
    labels: Record<string, string> = {}
  ): Promise<void> {
    // 如果已初始化，跳过
    if (this.timeSeriesInitialized.has(key)) {
      return;
    }

    try {
      // 使用 TS.CREATE 创建时间序列
      // 如果已存在会抛出错误，捕获并忽略
      const labelArgs: string[] = [];
      for (const [k, v] of Object.entries(labels)) {
        labelArgs.push('LABELS', k, v);
      }

      await this.client.call(
        'TS.CREATE',
        key,
        'RETENTION', retention,
        'DUPLICATE_POLICY', 'LAST', // 重复时间戳使用最后一个值
        ...labelArgs
      );

      // 标记已初始化
      this.timeSeriesInitialized.add(key);

    } catch (error: any) {
      // 如果是已存在错误，忽略
      if (error.message?.includes('already exists')) {
        this.timeSeriesInitialized.add(key);
        return;
      }

      // 其他错误，记录但不抛出
      console.error(`Failed to create TimeSeries ${key}:`, error.message);
    }
  }

  /**
   * 添加 TimeSeries 数据到缓冲区
   * @param item - 数据项
   */
  addTimeSeries(item: TimeSeriesItem): void {
    // 如果未启用，忽略
    if (!this.enableTimeSeries) {
      return;
    }

    // 添加到缓冲区
    this.buffer.timeSeries.push(item);

    // 如果达到批量大小，立即刷新
    if (this.buffer.timeSeries.length >= this.batchSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * 批量写入 TimeSeries 数据
   * @param items - 数据项列表
   */
  private async writeTimeSeries(items: TimeSeriesItem[]): Promise<void> {
    // 如果没有数据，跳过
    if (items.length === 0) {
      return;
    }

    try {
      // 使用 Pipeline 批量执行
      const pipeline = this.client.pipeline();

      // 遍历数据项
      for (const item of items) {
        // 构建 TS.ADD 命令
        // TS.ADD key timestamp value [LABELS label value ...]
        pipeline.call(
          'TS.ADD',
          item.key,
          item.timestamp,
          item.value,
          'ON_DUPLICATE', 'LAST' // 重复时间戳使用最后一个值
        );
      }

      // 执行 Pipeline
      await pipeline.exec();

      // 更新统计
      this.stats.timeSeriesWrites += items.length;

    } catch (error) {
      // 更新错误统计
      this.stats.errors++;

      // 记录错误
      console.error('Failed to write TimeSeries:', error);
    }
  }

  // ========================================================================
  // Pub/Sub 操作
  // ========================================================================

  /**
   * 添加消息到 Pub/Sub 缓冲区
   * @param message - 消息内容（JSON 字符串）
   */
  addPubSub(message: string): void {
    // 如果未启用，忽略
    if (!this.enablePubSub) {
      return;
    }

    // 添加到缓冲区
    this.buffer.pubSub.push(message);

    // 如果达到批量大小，立即刷新
    if (this.buffer.pubSub.length >= this.batchSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * 批量发布 Pub/Sub 消息
   * @param messages - 消息列表
   */
  private async publishMessages(messages: string[]): Promise<void> {
    // 如果没有消息，跳过
    if (messages.length === 0) {
      return;
    }

    try {
      // 使用 Pipeline 批量发布
      const pipeline = this.publisher.pipeline();

      // 遍历消息
      for (const message of messages) {
        pipeline.publish(this.pubSubChannel, message);
      }

      // 执行 Pipeline
      await pipeline.exec();

      // 更新统计
      this.stats.pubSubPublishes += messages.length;

    } catch (error) {
      // 更新错误统计
      this.stats.errors++;

      // 记录错误
      console.error('Failed to publish messages:', error);
    }
  }

  // ========================================================================
  // 批量操作
  // ========================================================================

  /**
   * 启动批量写入定时器
   */
  private startBatchTimer(): void {
    // 停止现有定时器
    this.stopBatchTimer();

    // 创建新定时器
    this.batchTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.batchInterval);

    // 设置为不阻止进程退出
    this.batchTimer.unref();
  }

  /**
   * 停止批量写入定时器
   */
  private stopBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * 刷新缓冲区（执行批量写入）
   */
  async flush(): Promise<void> {
    // 取出当前缓冲区数据
    const timeSeries = this.buffer.timeSeries;
    const pubSub = this.buffer.pubSub;

    // 清空缓冲区
    this.buffer.timeSeries = [];
    this.buffer.pubSub = [];

    // 并行执行写入和发布
    await Promise.all([
      this.writeTimeSeries(timeSeries),
      this.publishMessages(pubSub),
    ]);
  }

  // ========================================================================
  // 便捷方法
  // ========================================================================

  /**
   * 写入市场数据（自动处理 TimeSeries 和 Pub/Sub）
   * @param data - 统一市场数据
   */
  async writeMarketData(data: UnifiedMarketData): Promise<void> {
    // 获取保留时间
    const retention = this.getRetention(data.type);

    // 构建键名前缀
    const keyPrefix = `${data.exchange}:${data.symbol}:${data.type}`;

    // 根据数据类型处理
    switch (data.type) {
      case 'ticker':
        // 写入 ticker 数据的各个字段
        this.addTimeSeries({
          key: `${keyPrefix}:last`,
          timestamp: data.timestamp,
          value: data.last,
          labels: { exchange: data.exchange, symbol: data.symbol, field: 'last' },
        });
        this.addTimeSeries({
          key: `${keyPrefix}:bid`,
          timestamp: data.timestamp,
          value: data.bid,
        });
        this.addTimeSeries({
          key: `${keyPrefix}:ask`,
          timestamp: data.timestamp,
          value: data.ask,
        });
        this.addTimeSeries({
          key: `${keyPrefix}:volume`,
          timestamp: data.timestamp,
          value: data.volume24h,
        });
        break;

      case 'depth':
        // 深度数据写入最优价
        if (data.bids.length > 0) {
          this.addTimeSeries({
            key: `${keyPrefix}:bid1`,
            timestamp: data.timestamp,
            value: data.bids[0]![0],
          });
        }
        if (data.asks.length > 0) {
          this.addTimeSeries({
            key: `${keyPrefix}:ask1`,
            timestamp: data.timestamp,
            value: data.asks[0]![0],
          });
        }
        break;

      case 'trade':
        // 成交数据
        this.addTimeSeries({
          key: `${keyPrefix}:price`,
          timestamp: data.timestamp,
          value: data.price,
        });
        this.addTimeSeries({
          key: `${keyPrefix}:qty`,
          timestamp: data.timestamp,
          value: data.quantity,
        });
        break;

      case 'fundingRate':
        // 资金费率数据
        this.addTimeSeries({
          key: `${keyPrefix}:rate`,
          timestamp: data.timestamp,
          value: data.fundingRate,
        });
        this.addTimeSeries({
          key: `${keyPrefix}:mark`,
          timestamp: data.timestamp,
          value: data.markPrice,
        });
        break;
    }

    // 发布到 Pub/Sub
    this.addPubSub(JSON.stringify(data));
  }

  /**
   * 获取数据类型的保留时间
   * @param type - 数据类型
   */
  private getRetention(type: string): number {
    switch (type) {
      case 'ticker':
        return this.retention.ticker;
      case 'depth':
        return this.retention.depth;
      case 'trade':
        return this.retention.trade;
      case 'fundingRate':
        return this.retention.fundingRate;
      default:
        return this.retention.ticker;
    }
  }

  // ========================================================================
  // 统计信息
  // ========================================================================

  /**
   * 获取统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      timeSeriesWrites: 0,
      pubSubPublishes: 0,
      errors: 0,
    };
  }

  // ========================================================================
  // 查询方法
  // ========================================================================

  /**
   * 查询 TimeSeries 数据
   * @param key - 键名
   * @param from - 开始时间戳
   * @param to - 结束时间戳
   */
  async queryTimeSeries(
    key: string,
    from: number,
    to: number
  ): Promise<Array<[number, number]>> {
    try {
      // 使用 TS.RANGE 查询
      const result = await this.client.call(
        'TS.RANGE',
        key,
        from,
        to
      ) as Array<[number, string]>;

      // 转换结果
      return result.map(([ts, val]) => [ts, parseFloat(val)]);

    } catch (error) {
      console.error(`Failed to query TimeSeries ${key}:`, error);
      return [];
    }
  }

  /**
   * 获取 TimeSeries 最新值
   * @param key - 键名
   */
  async getLatest(key: string): Promise<{ timestamp: number; value: number } | null> {
    try {
      // 使用 TS.GET 获取最新值
      const result = await this.client.call('TS.GET', key) as [number, string] | null;

      if (result) {
        return {
          timestamp: result[0],
          value: parseFloat(result[1]),
        };
      }

      return null;

    } catch (error) {
      console.error(`Failed to get latest ${key}:`, error);
      return null;
    }
  }
}
