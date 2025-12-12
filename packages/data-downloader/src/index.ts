// ============================================================================
// @quant/data-downloader 包入口文件
// 导出所有公共 API：类型定义、下载器、工具函数
// ============================================================================

// ============================================================================
// 类型导出
// ============================================================================

// 导出所有类型定义
export type {
  // 交易所类型
  ExchangeId,

  // 数据类型
  DataType,

  // 原始数据类型
  RawKline,
  RawFundingRate,
  RawMarkPrice,
  RawOpenInterest,
  RawAggTrade,

  // 清洗后的数据类型
  CleanKline,
  CleanFundingRate,
  CleanMarkPrice,
  CleanOpenInterest,
  CleanAggTrade,

  // 检查点类型
  Checkpoint,
  CheckpointStore,

  // 配置类型
  DownloadConfig,
  ClickHouseConfig,

  // 事件类型
  DownloadProgressEvent,
  DownloaderEvents,

  // 工具类型
  SymbolInfo,
  DataStats,
} from './types';

// 导出常量
export {
  // 支持的交易所列表
  SUPPORTED_EXCHANGES,
  // 支持的数据类型列表
  SUPPORTED_DATA_TYPES,
  // 默认下载配置
  DEFAULT_DOWNLOAD_CONFIG,
  // 默认 ClickHouse 配置
  DEFAULT_CLICKHOUSE_CONFIG,
} from './types';

// ============================================================================
// 主类导出
// ============================================================================

// 导出数据下载器
export { DataDownloader, createDownloader } from './downloader';

// 导出 ClickHouse 数据库客户端
export { ClickHouseDatabase } from './clickhouse';

// 导出检查点管理器
export {
  CheckpointManager,
  FileCheckpointStore,
  ClickHouseCheckpointStore,
} from './checkpoint';

// ============================================================================
// 数据获取函数导出
// ============================================================================

// 导出 CCXT 数据获取函数
export {
  // 创建交易所实例
  createExchangeInstance,
  // 符号转换
  toExchangeSymbol,
  toUnifiedSymbol,
  // 市场信息
  fetchMarkets,
  // K线数据
  fetchKlines,
  fetchKlinesRange,
  // 资金费率
  fetchFundingRateHistory,
  fetchFundingRateHistoryRange,
  // 标记价格
  fetchMarkPriceHistory,
  fetchMarkPriceHistoryRange,
  // 持仓量
  fetchOpenInterestHistory,
  fetchOpenInterestHistoryRange,
  // 聚合成交
  fetchAggTrades,
  fetchAggTradesRange,
  // 工具
  getSymbolListingDate,
  hasFeature,
} from './fetcher';

// ============================================================================
// 数据清洗函数导出
// ============================================================================

// 导出数据清洗函数
export {
  // 单条数据清洗
  cleanKline,
  cleanFundingRate,
  cleanMarkPrice,
  cleanOpenInterest,
  cleanAggTrade,
  // 批量数据清洗
  cleanKlines,
  cleanFundingRates,
  cleanMarkPrices,
  cleanOpenInterests,
  cleanAggTrades,
  // 异常值检测
  detectKlineAnomalies,
  // 缺失数据填充
  fillMissingKlines,
  // 统计计算
  calculateKlineStats,
} from './cleaner';

// ============================================================================
// 使用示例
// ============================================================================

/**
 * @example 基础使用 - 下载 K线数据
 * ```typescript
 * import { createDownloader } from '@quant/data-downloader';
 *
 * // 创建下载器
 * const downloader = await createDownloader({
 *   exchanges: ['binance', 'bybit'],
 *   symbols: ['BTC/USDT:USDT', 'ETH/USDT:USDT'],
 *   dataTypes: ['kline', 'funding_rate'],
 *   startTime: '2020-01-01',
 * }, {
 *   host: 'localhost',
 *   port: 8123,
 *   database: 'quant',
 * });
 *
 * // 监听进度
 * downloader.on('progress', (event) => {
 *   console.log(`${event.exchange}/${event.symbol}: ${event.progress}%`);
 * });
 *
 * // 开始下载
 * await downloader.start();
 * ```
 *
 * @example 增量更新
 * ```typescript
 * import { createDownloader } from '@quant/data-downloader';
 *
 * const downloader = await createDownloader({
 *   exchanges: ['binance'],
 *   symbols: ['BTC/USDT:USDT'],
 *   dataTypes: ['kline'],
 *   startTime: '2020-01-01',
 * });
 *
 * // 增量更新（从上次下载位置继续）
 * await downloader.incrementalUpdate();
 * ```
 *
 * @example 直接使用 ClickHouse 客户端
 * ```typescript
 * import { ClickHouseDatabase } from '@quant/data-downloader';
 *
 * // 创建客户端
 * const db = new ClickHouseDatabase({
 *   host: 'localhost',
 *   database: 'quant',
 * });
 *
 * // 初始化（自动建表）
 * await db.initialize();
 *
 * // 查询 K线数据
 * const klines = await db.queryKlines(
 *   'binance',
 *   'BTC/USDT:USDT',
 *   new Date('2024-01-01'),
 *   new Date('2024-01-02')
 * );
 *
 * // 关闭连接
 * await db.close();
 * ```
 *
 * @example 使用 CCXT 获取数据（不存储）
 * ```typescript
 * import {
 *   createExchangeInstance,
 *   fetchKlinesRange,
 *   cleanKlines,
 * } from '@quant/data-downloader';
 *
 * // 创建交易所实例
 * const exchange = createExchangeInstance('binance');
 *
 * // 获取原始数据
 * const rawKlines = await fetchKlinesRange(
 *   exchange,
 *   'BTC/USDT:USDT',
 *   Date.now() - 24 * 60 * 60 * 1000, // 24小时前
 *   Date.now()
 * );
 *
 * // 清洗数据
 * const cleanedKlines = cleanKlines('binance', 'BTC/USDT:USDT', rawKlines);
 *
 * console.log(`获取了 ${cleanedKlines.length} 条 K线`);
 * ```
 *
 * @example CLI 使用
 * ```bash
 * # 下载数据
 * npx data-downloader download \
 *   -e binance,bybit,okx \
 *   -s BTC/USDT:USDT,ETH/USDT:USDT \
 *   -t kline,funding_rate \
 *   --start 2020-01-01 \
 *   --host localhost \
 *   --database quant
 *
 * # 增量更新
 * npx data-downloader update
 *
 * # 查看状态
 * npx data-downloader status
 *
 * # 列出交易对
 * npx data-downloader list-symbols binance --filter BTC
 * ```
 */
