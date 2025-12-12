// ============================================================================
// 检查点管理器
// 管理下载进度，支持断点续传和增量更新
// 支持文件存储和 ClickHouse 存储两种模式
// ============================================================================

import fs from 'fs/promises';
import path from 'path';

import {
  type ExchangeId,
  type DataType,
  type Checkpoint,
  type CheckpointStore,
} from './types';

import { ClickHouseDatabase } from './clickhouse';

// ============================================================================
// 文件检查点存储
// ============================================================================

/**
 * 基于文件的检查点存储
 * 将检查点保存为 JSON 文件
 * 适用于小规模下载或无 ClickHouse 环境
 */
export class FileCheckpointStore implements CheckpointStore {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 检查点存储目录
  private readonly checkpointDir: string;

  // 内存缓存（避免频繁读取文件）
  private cache: Map<string, Checkpoint> = new Map();

  // 是否已加载
  private loaded: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param checkpointDir - 检查点存储目录
   */
  constructor(checkpointDir: string = './checkpoints') {
    // 保存目录路径
    this.checkpointDir = checkpointDir;
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 初始化检查点存储
   * 创建目录并加载已有检查点
   */
  async initialize(): Promise<void> {
    // 确保目录存在
    await fs.mkdir(this.checkpointDir, { recursive: true });

    // 加载所有检查点
    await this.loadAll();
  }

  /**
   * 获取检查点
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   * @returns 检查点信息或 null
   */
  async get(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<Checkpoint | null> {
    // 确保已加载
    if (!this.loaded) {
      await this.loadAll();
    }

    // 构建键名
    const key = this.buildKey(exchange, symbol, dataType);

    // 从缓存获取
    return this.cache.get(key) || null;
  }

  /**
   * 保存检查点
   * @param checkpoint - 检查点信息
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    // 构建键名
    const key = this.buildKey(
      checkpoint.exchange,
      checkpoint.symbol,
      checkpoint.dataType
    );

    // 更新缓存
    this.cache.set(key, checkpoint);

    // 保存到文件
    await this.saveToFile(checkpoint);
  }

  /**
   * 获取所有检查点
   * @returns 所有检查点列表
   */
  async getAll(): Promise<Checkpoint[]> {
    // 确保已加载
    if (!this.loaded) {
      await this.loadAll();
    }

    // 返回所有缓存值
    return Array.from(this.cache.values());
  }

  /**
   * 删除检查点
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   */
  async delete(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<void> {
    // 构建键名
    const key = this.buildKey(exchange, symbol, dataType);

    // 从缓存删除
    this.cache.delete(key);

    // 删除文件
    const filePath = this.getFilePath(exchange, symbol, dataType);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在时忽略错误
    }
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 构建检查点键名
   */
  private buildKey(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): string {
    // 使用 : 分隔
    return `${exchange}:${symbol}:${dataType}`;
  }

  /**
   * 获取检查点文件路径
   */
  private getFilePath(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): string {
    // 将符号中的 / 和 : 替换为 _
    const safeSymbol = symbol.replace(/[/:]/g, '_');

    // 构建文件名
    const fileName = `${exchange}_${safeSymbol}_${dataType}.json`;

    // 返回完整路径
    return path.join(this.checkpointDir, fileName);
  }

  /**
   * 加载所有检查点文件
   */
  private async loadAll(): Promise<void> {
    try {
      // 读取目录内容
      const files = await fs.readdir(this.checkpointDir);

      // 遍历所有 JSON 文件
      for (const file of files) {
        // 只处理 JSON 文件
        if (!file.endsWith('.json')) {
          continue;
        }

        try {
          // 读取文件内容
          const filePath = path.join(this.checkpointDir, file);
          const content = await fs.readFile(filePath, 'utf-8');

          // 解析 JSON
          const checkpoint: Checkpoint = JSON.parse(content);

          // 构建键名并缓存
          const key = this.buildKey(
            checkpoint.exchange,
            checkpoint.symbol,
            checkpoint.dataType
          );
          this.cache.set(key, checkpoint);

        } catch (error) {
          // 单个文件加载失败，继续处理其他文件
          console.warn(`[Checkpoint] Failed to load ${file}:`, error);
        }
      }

      // 标记已加载
      this.loaded = true;

    } catch (error) {
      // 目录不存在或读取失败
      console.warn('[Checkpoint] Failed to load checkpoints:', error);
      this.loaded = true;
    }
  }

  /**
   * 保存检查点到文件
   */
  private async saveToFile(checkpoint: Checkpoint): Promise<void> {
    // 获取文件路径
    const filePath = this.getFilePath(
      checkpoint.exchange,
      checkpoint.symbol,
      checkpoint.dataType
    );

    // 序列化为 JSON（格式化输出）
    const content = JSON.stringify(checkpoint, null, 2);

    // 写入文件
    await fs.writeFile(filePath, content, 'utf-8');
  }
}

// ============================================================================
// ClickHouse 检查点存储
// ============================================================================

/**
 * 基于 ClickHouse 的检查点存储
 * 将检查点存储在数据库中
 * 适用于分布式环境或大规模下载
 */
export class ClickHouseCheckpointStore implements CheckpointStore {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // ClickHouse 数据库客户端
  private readonly db: ClickHouseDatabase;

  // 内存缓存
  private cache: Map<string, Checkpoint> = new Map();

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param db - ClickHouse 数据库客户端
   */
  constructor(db: ClickHouseDatabase) {
    this.db = db;
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 获取检查点
   */
  async get(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<Checkpoint | null> {
    // 先检查缓存
    const key = this.buildKey(exchange, symbol, dataType);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // 从数据库查询
    const result = await this.db.getCheckpoint(exchange, symbol, dataType);

    // 如果没有结果，返回 null
    if (!result) {
      return null;
    }

    // 构建检查点对象
    const checkpoint: Checkpoint = {
      exchange,
      symbol,
      dataType,
      lastTimestamp: result.lastTimestamp,
      updatedAt: Date.now(),
      status: result.status as Checkpoint['status'],
      downloadedCount: result.downloadedCount,
    };

    // 缓存结果
    this.cache.set(key, checkpoint);

    return checkpoint;
  }

  /**
   * 保存检查点
   */
  async save(checkpoint: Checkpoint): Promise<void> {
    // 更新缓存
    const key = this.buildKey(
      checkpoint.exchange,
      checkpoint.symbol,
      checkpoint.dataType
    );
    this.cache.set(key, checkpoint);

    // 保存到数据库
    await this.db.saveCheckpoint(
      checkpoint.exchange,
      checkpoint.symbol,
      checkpoint.dataType,
      checkpoint.lastTimestamp,
      checkpoint.status,
      checkpoint.downloadedCount,
      checkpoint.errorMessage
    );
  }

  /**
   * 获取所有检查点
   */
  async getAll(): Promise<Checkpoint[]> {
    // 从数据库查询所有检查点
    const rows = await this.db.query<{
      exchange: string;
      symbol: string;
      data_type: string;
      last_timestamp: string;
      status: string;
      downloaded_count: string;
      error_message: string;
    }>(`
      SELECT
        exchange,
        symbol,
        data_type,
        last_timestamp,
        status,
        downloaded_count,
        error_message
      FROM download_checkpoints FINAL
    `);

    // 转换为 Checkpoint 对象
    return rows.map((row) => ({
      exchange: row.exchange as ExchangeId,
      symbol: row.symbol,
      dataType: row.data_type as DataType,
      lastTimestamp: new Date(row.last_timestamp).getTime(),
      updatedAt: Date.now(),
      status: row.status as Checkpoint['status'],
      downloadedCount: parseInt(row.downloaded_count, 10),
      errorMessage: row.error_message || undefined,
    }));
  }

  /**
   * 删除检查点
   */
  async delete(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<void> {
    // 从缓存删除
    const key = this.buildKey(exchange, symbol, dataType);
    this.cache.delete(key);

    // 从数据库删除（使用 ALTER TABLE DELETE）
    await this.db.query(`
      ALTER TABLE download_checkpoints
      DELETE WHERE exchange = '${exchange}'
        AND symbol = '${symbol}'
        AND data_type = '${dataType}'
    `);
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 构建键名
   */
  private buildKey(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): string {
    return `${exchange}:${symbol}:${dataType}`;
  }
}

// ============================================================================
// 检查点管理器
// ============================================================================

/**
 * 检查点管理器
 * 提供高级检查点操作功能
 */
export class CheckpointManager {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 检查点存储
  private readonly store: CheckpointStore;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param store - 检查点存储实例
   */
  constructor(store: CheckpointStore) {
    this.store = store;
  }

  // ========================================================================
  // 工厂方法
  // ========================================================================

  /**
   * 创建文件存储的检查点管理器
   * @param checkpointDir - 检查点目录
   * @returns 检查点管理器实例
   */
  static async createFileManager(
    checkpointDir: string = './checkpoints'
  ): Promise<CheckpointManager> {
    // 创建文件存储
    const store = new FileCheckpointStore(checkpointDir);

    // 初始化
    await store.initialize();

    // 返回管理器
    return new CheckpointManager(store);
  }

  /**
   * 创建 ClickHouse 存储的检查点管理器
   * @param db - ClickHouse 数据库客户端
   * @returns 检查点管理器实例
   */
  static createClickHouseManager(
    db: ClickHouseDatabase
  ): CheckpointManager {
    // 创建 ClickHouse 存储
    const store = new ClickHouseCheckpointStore(db);

    // 返回管理器
    return new CheckpointManager(store);
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 获取下载起始时间
   * 如果存在检查点，从检查点位置继续；否则从指定时间开始
   *
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   * @param defaultStart - 默认起始时间
   * @returns 起始时间（毫秒）
   */
  async getStartTime(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType,
    defaultStart: number
  ): Promise<number> {
    // 获取检查点
    const checkpoint = await this.store.get(exchange, symbol, dataType);

    // 如果存在检查点且状态不是失败，从检查点位置继续
    if (checkpoint && checkpoint.status !== 'failed') {
      // 返回检查点时间 + 1ms（避免重复）
      return checkpoint.lastTimestamp + 1;
    }

    // 否则从默认时间开始
    return defaultStart;
  }

  /**
   * 更新下载进度
   *
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   * @param lastTimestamp - 最后下载的时间戳
   * @param downloadedCount - 本次下载数量
   */
  async updateProgress(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType,
    lastTimestamp: number,
    downloadedCount: number
  ): Promise<void> {
    // 获取现有检查点
    const existing = await this.store.get(exchange, symbol, dataType);

    // 计算总下载数量
    const totalCount = (existing?.downloadedCount || 0) + downloadedCount;

    // 保存检查点
    await this.store.save({
      exchange,
      symbol,
      dataType,
      lastTimestamp,
      updatedAt: Date.now(),
      status: 'running',
      downloadedCount: totalCount,
    });
  }

  /**
   * 标记下载完成
   *
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   * @param lastTimestamp - 最后时间戳
   * @param totalCount - 总下载数量
   */
  async markCompleted(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType,
    lastTimestamp: number,
    totalCount: number
  ): Promise<void> {
    await this.store.save({
      exchange,
      symbol,
      dataType,
      lastTimestamp,
      updatedAt: Date.now(),
      status: 'completed',
      downloadedCount: totalCount,
    });
  }

  /**
   * 标记下载失败
   *
   * @param exchange - 交易所 ID
   * @param symbol - 交易对符号
   * @param dataType - 数据类型
   * @param lastTimestamp - 最后时间戳
   * @param errorMessage - 错误信息
   */
  async markFailed(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType,
    lastTimestamp: number,
    errorMessage: string
  ): Promise<void> {
    // 获取现有检查点
    const existing = await this.store.get(exchange, symbol, dataType);

    await this.store.save({
      exchange,
      symbol,
      dataType,
      lastTimestamp,
      updatedAt: Date.now(),
      status: 'failed',
      downloadedCount: existing?.downloadedCount || 0,
      errorMessage,
    });
  }

  /**
   * 获取检查点信息
   */
  async getCheckpoint(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<Checkpoint | null> {
    return this.store.get(exchange, symbol, dataType);
  }

  /**
   * 获取所有检查点
   */
  async getAllCheckpoints(): Promise<Checkpoint[]> {
    return this.store.getAll();
  }

  /**
   * 重置检查点（重新下载）
   */
  async resetCheckpoint(
    exchange: ExchangeId,
    symbol: string,
    dataType: DataType
  ): Promise<void> {
    await this.store.delete(exchange, symbol, dataType);
  }

  /**
   * 获取下载统计
   */
  async getDownloadStats(): Promise<{
    total: number;
    completed: number;
    running: number;
    failed: number;
    pending: number;
  }> {
    // 获取所有检查点
    const checkpoints = await this.store.getAll();

    // 统计各状态数量
    const stats = {
      total: checkpoints.length,
      completed: 0,
      running: 0,
      failed: 0,
      pending: 0,
    };

    // 遍历统计
    for (const cp of checkpoints) {
      switch (cp.status) {
        case 'completed':
          stats.completed++;
          break;
        case 'running':
          stats.running++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'pending':
          stats.pending++;
          break;
      }
    }

    return stats;
  }
}
