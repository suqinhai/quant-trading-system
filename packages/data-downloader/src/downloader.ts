// ============================================================================
// 数据下载器主模块
// 协调 CCXT 数据获取、数据清洗、ClickHouse 存储
// 支持断点续传和增量更新
// ============================================================================

import { EventEmitter } from 'eventemitter3';
import { Exchange } from 'ccxt';

import {
  type ExchangeId,
  type DataType,
  type DownloadConfig,
  type DownloadProgressEvent,
  type DownloaderEvents,
  type SymbolInfo,
  DEFAULT_DOWNLOAD_CONFIG,
  SUPPORTED_EXCHANGES,
} from './types.js';

import { ClickHouseDatabase } from './clickhouse.js';
import { CheckpointManager } from './checkpoint.js';

import {
  createExchangeInstance,
  fetchMarkets,
  fetchKlinesRange,
  fetchFundingRateHistoryRange,
  fetchMarkPriceHistoryRange,
  fetchOpenInterestHistoryRange,
  fetchAggTradesRange,
} from './fetcher.js';

import {
  cleanKlines,
  cleanFundingRates,
  cleanMarkPrices,
  cleanOpenInterests,
  cleanAggTrades,
} from './cleaner.js';

// ============================================================================
// 下载任务类型
// ============================================================================

/**
 * 下载任务
 */
interface DownloadTask {
  // 交易所 ID
  exchange: ExchangeId;
  // 交易对符号
  symbol: string;
  // 数据类型
  dataType: DataType;
  // 开始时间
  startTime: number;
  // 结束时间
  endTime: number;
}

// ============================================================================
// 数据下载器类
// ============================================================================

/**
 * 数据下载器
 *
 * 功能：
 * - 批量下载历史数据（K线、资金费率、标记价格、持仓量、成交）
 * - 支持断点续传
 * - 支持增量更新
 * - 数据清洗和验证
 * - ClickHouse 自动建表和存储
 */
export class DataDownloader extends EventEmitter<DownloaderEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // ClickHouse 数据库客户端
  private db: ClickHouseDatabase;

  // 检查点管理器
  private checkpointManager: CheckpointManager;

  // CCXT 交易所实例缓存
  private exchanges: Map<ExchangeId, Exchange> = new Map();

  // 交易对信息缓存
  private symbolsCache: Map<ExchangeId, SymbolInfo[]> = new Map();

  // 配置
  private config: Required<DownloadConfig>;

  // 是否正在运行
  private running: boolean = false;

  // 是否应该停止
  private shouldStop: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param db - ClickHouse 数据库客户端
   * @param checkpointManager - 检查点管理器
   * @param config - 下载配置
   */
  constructor(
    db: ClickHouseDatabase,
    checkpointManager: CheckpointManager,
    config: DownloadConfig
  ) {
    // 初始化 EventEmitter
    super();

    // 保存数据库客户端
    this.db = db;

    // 保存检查点管理器
    this.checkpointManager = checkpointManager;

    // 合并配置
    this.config = {
      ...DEFAULT_DOWNLOAD_CONFIG,
      ...config,
      // 转换时间格式
      startTime: this.parseTime(config.startTime),
      endTime: config.endTime
        ? this.parseTime(config.endTime)
        : Date.now(),
    } as Required<DownloadConfig>;
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 开始下载
   * 按配置下载所有数据
   */
  async start(): Promise<void> {
    // 如果已在运行，跳过
    if (this.running) {
      console.log('[Downloader] Already running');
      return;
    }

    // 标记运行状态
    this.running = true;
    this.shouldStop = false;

    try {
      // 初始化数据库
      await this.db.initialize();

      // 初始化交易所实例
      await this.initializeExchanges();

      // 生成下载任务
      const tasks = await this.generateTasks();

      console.log(`[Downloader] Generated ${tasks.length} download tasks`);

      // 执行下载任务
      await this.executeTasks(tasks);

      console.log('[Downloader] All tasks completed');

    } catch (error) {
      console.error('[Downloader] Download failed:', error);
      throw error;

    } finally {
      // 重置运行状态
      this.running = false;
    }
  }

  /**
   * 停止下载
   */
  stop(): void {
    console.log('[Downloader] Stopping...');
    this.shouldStop = true;
  }

  /**
   * 检查是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 增量更新
   * 只下载上次下载之后的新数据
   */
  async incrementalUpdate(): Promise<void> {
    // 设置结束时间为当前时间
    this.config.endTime = Date.now();

    // 执行下载（会自动从检查点恢复）
    await this.start();
  }

  /**
   * 获取支持的交易对列表
   * @param exchange - 交易所 ID
   * @returns 交易对信息列表
   */
  async getSymbols(exchange: ExchangeId): Promise<SymbolInfo[]> {
    // 检查缓存
    if (this.symbolsCache.has(exchange)) {
      return this.symbolsCache.get(exchange)!;
    }

    // 获取交易所实例
    const ex = await this.getExchange(exchange);

    // 获取市场信息
    const symbols = await fetchMarkets(ex, exchange);

    // 缓存结果
    this.symbolsCache.set(exchange, symbols);

    return symbols;
  }

  // ========================================================================
  // 私有方法 - 初始化
  // ========================================================================

  /**
   * 初始化交易所实例
   */
  private async initializeExchanges(): Promise<void> {
    // 遍历配置中的交易所
    for (const exchangeId of this.config.exchanges) {
      // 创建实例
      const exchange = createExchangeInstance(exchangeId);

      // 加载市场信息
      await exchange.loadMarkets();

      // 缓存实例
      this.exchanges.set(exchangeId, exchange);

      console.log(`[Downloader] Initialized ${exchangeId}`);
    }
  }

  /**
   * 获取交易所实例
   */
  private async getExchange(exchangeId: ExchangeId): Promise<Exchange> {
    // 检查缓存
    if (this.exchanges.has(exchangeId)) {
      return this.exchanges.get(exchangeId)!;
    }

    // 创建新实例
    const exchange = createExchangeInstance(exchangeId);
    await exchange.loadMarkets();
    this.exchanges.set(exchangeId, exchange);

    return exchange;
  }

  // ========================================================================
  // 私有方法 - 任务生成
  // ========================================================================

  /**
   * 生成下载任务列表
   */
  private async generateTasks(): Promise<DownloadTask[]> {
    // 任务列表
    const tasks: DownloadTask[] = [];

    // 遍历交易所
    for (const exchange of this.config.exchanges) {
      // 遍历交易对
      for (const symbol of this.config.symbols) {
        // 遍历数据类型
        for (const dataType of this.config.dataTypes) {
          // 获取起始时间（考虑断点续传）
          const startTime = await this.checkpointManager.getStartTime(
            exchange,
            symbol,
            dataType,
            this.config.startTime as number
          );

          // 如果起始时间已经超过结束时间，跳过
          if (startTime >= (this.config.endTime as number)) {
            // 发出跳过事件
            this.emit('skip', exchange, symbol, dataType, 'Already up to date');
            continue;
          }

          // 创建任务
          tasks.push({
            exchange,
            symbol,
            dataType,
            startTime,
            endTime: this.config.endTime as number,
          });
        }
      }
    }

    return tasks;
  }

  // ========================================================================
  // 私有方法 - 任务执行
  // ========================================================================

  /**
   * 执行下载任务
   */
  private async executeTasks(tasks: DownloadTask[]): Promise<void> {
    // 按并发数分组执行
    const concurrency = this.config.concurrency;

    // 遍历执行
    for (let i = 0; i < tasks.length; i += concurrency) {
      // 检查是否应该停止
      if (this.shouldStop) {
        console.log('[Downloader] Stopped by user');
        break;
      }

      // 获取当前批次的任务
      const batch = tasks.slice(i, i + concurrency);

      // 并行执行
      await Promise.all(
        batch.map((task) => this.executeTask(task))
      );
    }
  }

  /**
   * 执行单个下载任务
   */
  private async executeTask(task: DownloadTask): Promise<void> {
    // 发出开始事件
    this.emit('start', task.exchange, task.symbol, task.dataType);

    console.log(
      `[Downloader] Starting ${task.exchange}/${task.symbol}/${task.dataType} ` +
      `from ${new Date(task.startTime).toISOString()}`
    );

    try {
      // 根据数据类型调用不同的下载方法
      switch (task.dataType) {
        case 'kline':
          await this.downloadKlines(task);
          break;

        case 'funding_rate':
          await this.downloadFundingRates(task);
          break;

        case 'mark_price':
          await this.downloadMarkPrices(task);
          break;

        case 'open_interest':
          await this.downloadOpenInterests(task);
          break;

        case 'agg_trade':
          await this.downloadAggTrades(task);
          break;
      }

    } catch (error) {
      // 记录错误
      console.error(
        `[Downloader] Failed ${task.exchange}/${task.symbol}/${task.dataType}:`,
        error
      );

      // 标记失败
      await this.checkpointManager.markFailed(
        task.exchange,
        task.symbol,
        task.dataType,
        task.startTime,
        (error as Error).message
      );

      // 发出错误事件
      this.emit('error', task.exchange, task.symbol, task.dataType, error as Error);
    }
  }

  // ========================================================================
  // 私有方法 - 数据下载
  // ========================================================================

  /**
   * 下载 K线数据
   */
  private async downloadKlines(task: DownloadTask): Promise<void> {
    // 获取交易所实例
    const exchange = await this.getExchange(task.exchange);

    // 总下载数量
    let totalCount = 0;

    // 当前位置
    let currentTime = task.startTime;

    // 批量大小
    const batchSize = this.config.batchSize;

    // 循环下载
    while (currentTime < task.endTime && !this.shouldStop) {
      // 获取数据
      const rawKlines = await fetchKlinesRange(
        exchange,
        task.symbol,
        currentTime,
        Math.min(currentTime + batchSize * 60000, task.endTime),
        (current, total) => {
          // 发出进度事件
          this.emitProgress(task, current, total, totalCount);
        }
      );

      // 如果没有数据，结束
      if (rawKlines.length === 0) {
        break;
      }

      // 清洗数据
      const cleanedKlines = cleanKlines(
        task.exchange,
        task.symbol,
        rawKlines
      );

      // 写入数据库
      if (cleanedKlines.length > 0) {
        await this.db.insertKlines(cleanedKlines);

        // 更新进度
        totalCount += cleanedKlines.length;
        currentTime = cleanedKlines[cleanedKlines.length - 1]!.open_time.getTime() + 60000;

        // 保存检查点
        await this.checkpointManager.updateProgress(
          task.exchange,
          task.symbol,
          task.dataType,
          currentTime,
          cleanedKlines.length
        );
      }

      // 限速延迟
      await this.delay(this.config.requestDelay);
    }

    // 标记完成
    await this.checkpointManager.markCompleted(
      task.exchange,
      task.symbol,
      task.dataType,
      currentTime,
      totalCount
    );

    // 发出完成事件
    this.emit('complete', task.exchange, task.symbol, task.dataType, totalCount);

    console.log(
      `[Downloader] Completed ${task.exchange}/${task.symbol}/${task.dataType}: ` +
      `${totalCount} records`
    );
  }

  /**
   * 下载资金费率数据
   */
  private async downloadFundingRates(task: DownloadTask): Promise<void> {
    const exchange = await this.getExchange(task.exchange);
    let totalCount = 0;
    let currentTime = task.startTime;

    while (currentTime < task.endTime && !this.shouldStop) {
      // 获取数据
      const rawRates = await fetchFundingRateHistoryRange(
        exchange,
        task.exchange,
        task.symbol,
        currentTime,
        task.endTime,
        (current, total) => {
          this.emitProgress(task, current, total, totalCount);
        }
      );

      if (rawRates.length === 0) {
        break;
      }

      // 清洗数据
      const cleanedRates = cleanFundingRates(
        task.exchange,
        task.symbol,
        rawRates
      );

      // 写入数据库
      if (cleanedRates.length > 0) {
        await this.db.insertFundingRates(cleanedRates);
        totalCount += cleanedRates.length;
        currentTime = cleanedRates[cleanedRates.length - 1]!.funding_time.getTime() + 1;

        await this.checkpointManager.updateProgress(
          task.exchange,
          task.symbol,
          task.dataType,
          currentTime,
          cleanedRates.length
        );
      }

      // 资金费率数据量小，一次获取完成后就退出
      break;
    }

    await this.checkpointManager.markCompleted(
      task.exchange,
      task.symbol,
      task.dataType,
      currentTime,
      totalCount
    );

    this.emit('complete', task.exchange, task.symbol, task.dataType, totalCount);

    console.log(
      `[Downloader] Completed ${task.exchange}/${task.symbol}/${task.dataType}: ` +
      `${totalCount} records`
    );
  }

  /**
   * 下载标记价格数据
   */
  private async downloadMarkPrices(task: DownloadTask): Promise<void> {
    const exchange = await this.getExchange(task.exchange);
    let totalCount = 0;
    let currentTime = task.startTime;
    const batchSize = this.config.batchSize;

    while (currentTime < task.endTime && !this.shouldStop) {
      const rawPrices = await fetchMarkPriceHistoryRange(
        exchange,
        task.exchange,
        task.symbol,
        currentTime,
        Math.min(currentTime + batchSize * 60000, task.endTime),
        (current, total) => {
          this.emitProgress(task, current, total, totalCount);
        }
      );

      if (rawPrices.length === 0) {
        break;
      }

      const cleanedPrices = cleanMarkPrices(
        task.exchange,
        task.symbol,
        rawPrices
      );

      if (cleanedPrices.length > 0) {
        await this.db.insertMarkPrices(cleanedPrices);
        totalCount += cleanedPrices.length;
        currentTime = cleanedPrices[cleanedPrices.length - 1]!.timestamp.getTime() + 60000;

        await this.checkpointManager.updateProgress(
          task.exchange,
          task.symbol,
          task.dataType,
          currentTime,
          cleanedPrices.length
        );
      }

      await this.delay(this.config.requestDelay);
    }

    await this.checkpointManager.markCompleted(
      task.exchange,
      task.symbol,
      task.dataType,
      currentTime,
      totalCount
    );

    this.emit('complete', task.exchange, task.symbol, task.dataType, totalCount);

    console.log(
      `[Downloader] Completed ${task.exchange}/${task.symbol}/${task.dataType}: ` +
      `${totalCount} records`
    );
  }

  /**
   * 下载持仓量数据
   */
  private async downloadOpenInterests(task: DownloadTask): Promise<void> {
    const exchange = await this.getExchange(task.exchange);
    let totalCount = 0;
    let currentTime = task.startTime;
    const batchSize = this.config.batchSize;

    while (currentTime < task.endTime && !this.shouldStop) {
      const rawOI = await fetchOpenInterestHistoryRange(
        exchange,
        task.exchange,
        task.symbol,
        currentTime,
        Math.min(currentTime + batchSize * 5 * 60000, task.endTime), // OI 是 5 分钟周期
        (current, total) => {
          this.emitProgress(task, current, total, totalCount);
        }
      );

      if (rawOI.length === 0) {
        break;
      }

      const cleanedOI = cleanOpenInterests(
        task.exchange,
        task.symbol,
        rawOI
      );

      if (cleanedOI.length > 0) {
        await this.db.insertOpenInterests(cleanedOI);
        totalCount += cleanedOI.length;
        currentTime = cleanedOI[cleanedOI.length - 1]!.timestamp.getTime() + 5 * 60000;

        await this.checkpointManager.updateProgress(
          task.exchange,
          task.symbol,
          task.dataType,
          currentTime,
          cleanedOI.length
        );
      }

      await this.delay(this.config.requestDelay);
    }

    await this.checkpointManager.markCompleted(
      task.exchange,
      task.symbol,
      task.dataType,
      currentTime,
      totalCount
    );

    this.emit('complete', task.exchange, task.symbol, task.dataType, totalCount);

    console.log(
      `[Downloader] Completed ${task.exchange}/${task.symbol}/${task.dataType}: ` +
      `${totalCount} records`
    );
  }

  /**
   * 下载聚合成交数据
   */
  private async downloadAggTrades(task: DownloadTask): Promise<void> {
    const exchange = await this.getExchange(task.exchange);
    let totalCount = 0;
    let currentTime = task.startTime;

    // 成交数据量很大，每次只获取一小段时间
    const timeStep = 60 * 60 * 1000; // 1 小时

    while (currentTime < task.endTime && !this.shouldStop) {
      const rawTrades = await fetchAggTradesRange(
        exchange,
        task.symbol,
        currentTime,
        Math.min(currentTime + timeStep, task.endTime),
        (current, total) => {
          this.emitProgress(task, current, total, totalCount);
        }
      );

      if (rawTrades.length === 0) {
        // 没有数据，跳到下一个时间段
        currentTime += timeStep;
        continue;
      }

      const cleanedTrades = cleanAggTrades(
        task.exchange,
        task.symbol,
        rawTrades
      );

      if (cleanedTrades.length > 0) {
        await this.db.insertAggTrades(cleanedTrades);
        totalCount += cleanedTrades.length;
        currentTime = cleanedTrades[cleanedTrades.length - 1]!.timestamp.getTime() + 1;

        await this.checkpointManager.updateProgress(
          task.exchange,
          task.symbol,
          task.dataType,
          currentTime,
          cleanedTrades.length
        );
      }

      await this.delay(this.config.requestDelay);
    }

    await this.checkpointManager.markCompleted(
      task.exchange,
      task.symbol,
      task.dataType,
      currentTime,
      totalCount
    );

    this.emit('complete', task.exchange, task.symbol, task.dataType, totalCount);

    console.log(
      `[Downloader] Completed ${task.exchange}/${task.symbol}/${task.dataType}: ` +
      `${totalCount} records`
    );
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 解析时间
   */
  private parseTime(time: number | string): number {
    if (typeof time === 'number') {
      return time;
    }
    return new Date(time).getTime();
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 发出进度事件
   */
  private emitProgress(
    task: DownloadTask,
    current: number,
    total: number,
    downloadedCount: number
  ): void {
    // 计算进度百分比
    const progress = Math.min(100, Math.max(0,
      ((current - task.startTime) / (task.endTime - task.startTime)) * 100
    ));

    // 构建进度事件
    const event: DownloadProgressEvent = {
      exchange: task.exchange,
      symbol: task.symbol,
      dataType: task.dataType,
      progress,
      downloadedCount,
      currentTimestamp: current,
      targetTimestamp: task.endTime,
    };

    // 发出事件
    this.emit('progress', event);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建数据下载器实例
 *
 * @param config - 下载配置
 * @param clickhouseConfig - ClickHouse 配置
 * @returns 下载器实例
 */
export async function createDownloader(
  config: DownloadConfig,
  clickhouseConfig?: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
  }
): Promise<DataDownloader> {
  // 创建 ClickHouse 客户端
  const db = new ClickHouseDatabase(clickhouseConfig);

  // 初始化数据库
  await db.initialize();

  // 创建检查点管理器
  const checkpointManager = CheckpointManager.createClickHouseManager(db);

  // 创建下载器
  return new DataDownloader(db, checkpointManager, config);
}
