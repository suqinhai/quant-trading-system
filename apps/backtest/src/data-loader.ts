// ============================================================================
// 回测数据加载器
// 支持从文件或 API 加载历史 K 线数据
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import Decimal from 'decimal.js';
import pino from 'pino';

import type { Kline } from '@quant/backtest';

// ============================================================================
// 数据源类型
// ============================================================================

/**
 * 数据源类型
 */
export type DataSource = 'file' | 'api';

/**
 * 数据格式
 */
export type DataFormat = 'json' | 'csv';

/**
 * 数据加载配置
 */
export interface DataLoaderConfig {
  // 数据源类型
  readonly source: DataSource;

  // 数据格式
  readonly format: DataFormat;

  // 数据目录（文件数据源）
  readonly dataDir?: string;

  // API 基础 URL（API 数据源）
  readonly apiBaseUrl?: string;

  // API 密钥（API 数据源）
  readonly apiKey?: string;
}

// ============================================================================
// 数据加载器
// ============================================================================

/**
 * 历史数据加载器
 *
 * 功能：
 * - 从 JSON/CSV 文件加载 K 线数据
 * - 从 API 获取历史数据
 * - 数据验证和清洗
 * - 时间范围过滤
 */
export class DataLoader {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: DataLoaderConfig;

  /**
   * 构造函数
   */
  public constructor(config: DataLoaderConfig) {
    this.config = config;

    // 初始化日志
    this.logger = pino({
      name: 'DataLoader',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });
  }

  // ==========================================================================
  // 数据加载
  // ==========================================================================

  /**
   * 加载 K 线数据
   */
  public async loadKlines(
    symbol: string,
    timeframe: string,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    this.logger.info({ symbol, timeframe, startTime, endTime }, 'Loading klines');

    let klines: Kline[];

    if (this.config.source === 'file') {
      klines = await this.loadFromFile(symbol, timeframe);
    } else {
      klines = await this.loadFromAPI(symbol, timeframe, startTime, endTime);
    }

    // 时间范围过滤
    if (startTime || endTime) {
      klines = klines.filter(k => {
        if (startTime && k.timestamp < startTime) return false;
        if (endTime && k.timestamp > endTime) return false;
        return true;
      });
    }

    // 按时间排序
    klines.sort((a, b) => a.timestamp - b.timestamp);

    this.logger.info({ symbol, count: klines.length }, 'Klines loaded');

    return klines;
  }

  /**
   * 从文件加载数据
   */
  private async loadFromFile(symbol: string, timeframe: string): Promise<Kline[]> {
    const dataDir = this.config.dataDir ?? './data';

    // 构建文件路径
    const safeSymbol = symbol.replace('/', '_');
    const filename = `${safeSymbol}_${timeframe}.${this.config.format}`;
    const filepath = path.join(dataDir, filename);

    // 检查文件是否存在
    try {
      await fs.access(filepath);
    } catch {
      throw new Error(`Data file not found: ${filepath}`);
    }

    // 读取文件内容
    const content = await fs.readFile(filepath, 'utf-8');

    // 解析数据
    if (this.config.format === 'json') {
      return this.parseJSON(content);
    } else {
      return this.parseCSV(content);
    }
  }

  /**
   * 解析 JSON 数据
   */
  private parseJSON(content: string): Kline[] {
    const data = JSON.parse(content) as Array<{
      timestamp: number;
      open: number | string;
      high: number | string;
      low: number | string;
      close: number | string;
      volume: number | string;
    }>;

    return data.map(item => ({
      timestamp: item.timestamp,
      open: new Decimal(item.open),
      high: new Decimal(item.high),
      low: new Decimal(item.low),
      close: new Decimal(item.close),
      volume: new Decimal(item.volume),
    }));
  }

  /**
   * 解析 CSV 数据
   */
  private parseCSV(content: string): Kline[] {
    const lines = content.trim().split('\n');

    // 跳过表头
    const dataLines = lines.slice(1);

    return dataLines.map(line => {
      const [timestamp, open, high, low, close, volume] = line.split(',');

      return {
        timestamp: parseInt(timestamp ?? '0', 10),
        open: new Decimal(open ?? 0),
        high: new Decimal(high ?? 0),
        low: new Decimal(low ?? 0),
        close: new Decimal(close ?? 0),
        volume: new Decimal(volume ?? 0),
      };
    });
  }

  /**
   * 从 API 加载数据
   */
  private async loadFromAPI(
    symbol: string,
    timeframe: string,
    startTime?: number,
    endTime?: number
  ): Promise<Kline[]> {
    if (!this.config.apiBaseUrl) {
      throw new Error('API base URL is required for API data source');
    }

    // 构建请求 URL
    const params = new URLSearchParams({
      symbol,
      interval: timeframe,
    });

    if (startTime) {
      params.set('startTime', startTime.toString());
    }
    if (endTime) {
      params.set('endTime', endTime.toString());
    }

    const url = `${this.config.apiBaseUrl}/klines?${params.toString()}`;

    // 发送请求
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json() as Array<[number, string, string, string, string, string]>;

    // 转换为 Kline 格式
    return data.map(item => ({
      timestamp: item[0],
      open: new Decimal(item[1]),
      high: new Decimal(item[2]),
      low: new Decimal(item[3]),
      close: new Decimal(item[4]),
      volume: new Decimal(item[5]),
    }));
  }

  // ==========================================================================
  // 数据生成（用于测试）
  // ==========================================================================

  /**
   * 生成模拟 K 线数据
   */
  public static generateMockKlines(
    symbol: string,
    startTime: number,
    endTime: number,
    intervalMs: number = 60000, // 默认 1 分钟
    startPrice: number = 100
  ): Kline[] {
    const klines: Kline[] = [];
    let currentPrice = startPrice;
    let currentTime = startTime;

    while (currentTime < endTime) {
      // 随机价格变动（-2% 到 +2%）
      const change = (Math.random() - 0.5) * 0.04;
      const open = new Decimal(currentPrice);

      // 生成 OHLC
      const high = open.times(1 + Math.random() * 0.02);
      const low = open.times(1 - Math.random() * 0.02);
      const close = open.times(1 + change);

      // 随机成交量
      const volume = new Decimal(Math.random() * 1000 + 100);

      klines.push({
        timestamp: currentTime,
        open,
        high,
        low,
        close,
        volume,
      });

      currentPrice = close.toNumber();
      currentTime += intervalMs;
    }

    return klines;
  }

  /**
   * 保存 K 线数据到文件
   */
  public async saveKlines(
    symbol: string,
    timeframe: string,
    klines: Kline[]
  ): Promise<void> {
    const dataDir = this.config.dataDir ?? './data';

    // 确保目录存在
    await fs.mkdir(dataDir, { recursive: true });

    // 构建文件路径
    const safeSymbol = symbol.replace('/', '_');
    const filename = `${safeSymbol}_${timeframe}.${this.config.format}`;
    const filepath = path.join(dataDir, filename);

    // 转换数据格式
    let content: string;

    if (this.config.format === 'json') {
      content = JSON.stringify(
        klines.map(k => ({
          timestamp: k.timestamp,
          open: k.open.toString(),
          high: k.high.toString(),
          low: k.low.toString(),
          close: k.close.toString(),
          volume: k.volume.toString(),
        })),
        null,
        2
      );
    } else {
      const header = 'timestamp,open,high,low,close,volume';
      const lines = klines.map(k =>
        `${k.timestamp},${k.open},${k.high},${k.low},${k.close},${k.volume}`
      );
      content = [header, ...lines].join('\n');
    }

    // 写入文件
    await fs.writeFile(filepath, content, 'utf-8');

    this.logger.info({ filepath, count: klines.length }, 'Klines saved');
  }
}
