// ============================================================================
// 指标收集器
// 收集和管理系统指标、交易指标
// ============================================================================

import Decimal from 'decimal.js';
import pino from 'pino';

import type {
  Metric,
  MetricDefinition,
  MetricPoint,
  MetricType,
  TradingStats,
} from './types.js';

// ============================================================================
// 指标收集器
// ============================================================================

/**
 * 指标收集器
 *
 * 功能：
 * - 定义和注册指标
 * - 记录指标数据
 * - 保留历史数据
 * - 计算统计信息
 */
export class MetricsCollector {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 指标存储
  private readonly metrics: Map<string, Metric> = new Map();

  // 历史数据保留时间（毫秒）
  private readonly retention: number;

  // 最大历史点数
  private readonly maxHistoryPoints: number;

  // 交易统计
  private tradingStats: TradingStats;

  /**
   * 构造函数
   */
  public constructor(retention: number = 3600000, maxHistoryPoints: number = 1000) {
    this.retention = retention;
    this.maxHistoryPoints = maxHistoryPoints;

    // 初始化日志
    this.logger = pino({
      name: 'MetricsCollector',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化交易统计
    this.tradingStats = this.createEmptyTradingStats();

    // 注册内置指标
    this.registerBuiltInMetrics();

    this.logger.info('MetricsCollector initialized');
  }

  /**
   * 创建空的交易统计
   */
  private createEmptyTradingStats(): TradingStats {
    return {
      totalOrders: 0,
      successfulOrders: 0,
      failedOrders: 0,
      cancelledOrders: 0,
      totalVolume: new Decimal(0),
      totalValue: new Decimal(0),
      totalFees: new Decimal(0),
      realizedPnL: new Decimal(0),
      unrealizedPnL: new Decimal(0),
      totalPnL: new Decimal(0),
      startTime: Date.now(),
      lastUpdated: Date.now(),
    };
  }

  /**
   * 注册内置指标
   */
  private registerBuiltInMetrics(): void {
    // === 系统指标 ===
    this.register({
      name: 'system_cpu_usage',
      type: 'gauge',
      description: 'CPU 使用率（百分比）',
      unit: '%',
    });

    this.register({
      name: 'system_memory_used',
      type: 'gauge',
      description: '已使用内存（MB）',
      unit: 'MB',
    });

    this.register({
      name: 'system_memory_total',
      type: 'gauge',
      description: '总内存（MB）',
      unit: 'MB',
    });

    this.register({
      name: 'system_uptime',
      type: 'counter',
      description: '系统运行时间（秒）',
      unit: 's',
    });

    // === 交易指标 ===
    this.register({
      name: 'trading_orders_total',
      type: 'counter',
      description: '总订单数',
      labelKeys: ['status'],
    });

    this.register({
      name: 'trading_volume',
      type: 'counter',
      description: '总成交量',
      labelKeys: ['symbol'],
    });

    this.register({
      name: 'trading_pnl_realized',
      type: 'gauge',
      description: '已实现盈亏',
      labelKeys: ['symbol'],
    });

    this.register({
      name: 'trading_pnl_unrealized',
      type: 'gauge',
      description: '未实现盈亏',
      labelKeys: ['symbol'],
    });

    // === 策略指标 ===
    this.register({
      name: 'strategy_signals_total',
      type: 'counter',
      description: '策略信号总数',
      labelKeys: ['strategy', 'signal'],
    });

    this.register({
      name: 'strategy_win_rate',
      type: 'gauge',
      description: '策略胜率',
      unit: '%',
      labelKeys: ['strategy'],
    });

    // === 连接指标 ===
    this.register({
      name: 'connection_latency',
      type: 'histogram',
      description: '连接延迟（毫秒）',
      unit: 'ms',
      labelKeys: ['exchange'],
    });

    this.register({
      name: 'connection_errors_total',
      type: 'counter',
      description: '连接错误总数',
      labelKeys: ['exchange', 'error_type'],
    });
  }

  // ==========================================================================
  // 指标管理
  // ==========================================================================

  /**
   * 注册指标
   */
  public register(definition: MetricDefinition): void {
    if (this.metrics.has(definition.name)) {
      this.logger.warn({ name: definition.name }, 'Metric already registered');
      return;
    }

    const metric: Metric = {
      ...definition,
      value: 0,
      lastUpdated: Date.now(),
      history: [],
    };

    this.metrics.set(definition.name, metric);
    this.logger.debug({ name: definition.name }, 'Metric registered');
  }

  /**
   * 获取指标
   */
  public get(name: string): Metric | undefined {
    return this.metrics.get(name);
  }

  /**
   * 获取所有指标
   */
  public getAll(): Metric[] {
    return Array.from(this.metrics.values());
  }

  // ==========================================================================
  // 数据记录
  // ==========================================================================

  /**
   * 设置指标值（用于 Gauge 类型）
   */
  public set(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn({ name }, 'Metric not found');
      return;
    }

    const now = Date.now();

    // 更新当前值
    metric.value = value;
    metric.lastUpdated = now;

    // 添加历史点
    this.addHistoryPoint(metric, { timestamp: now, value, labels });
  }

  /**
   * 增加计数器（用于 Counter 类型）
   */
  public increment(name: string, value: number = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn({ name }, 'Metric not found');
      return;
    }

    if (metric.type !== 'counter') {
      this.logger.warn({ name, type: metric.type }, 'Cannot increment non-counter metric');
      return;
    }

    const now = Date.now();

    // 增加值
    metric.value += value;
    metric.lastUpdated = now;

    // 添加历史点
    this.addHistoryPoint(metric, { timestamp: now, value: metric.value, labels });
  }

  /**
   * 记录直方图值（用于 Histogram 类型）
   */
  public observe(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (!metric) {
      this.logger.warn({ name }, 'Metric not found');
      return;
    }

    const now = Date.now();

    // 对于直方图，value 存储最近的观测值
    metric.value = value;
    metric.lastUpdated = now;

    // 添加历史点
    this.addHistoryPoint(metric, { timestamp: now, value, labels });
  }

  /**
   * 添加历史点
   */
  private addHistoryPoint(metric: Metric, point: MetricPoint): void {
    // 添加新点
    metric.history.push(point);

    // 清理过期数据
    const cutoff = Date.now() - this.retention;
    metric.history = metric.history.filter(p => p.timestamp > cutoff);

    // 限制历史点数
    if (metric.history.length > this.maxHistoryPoints) {
      metric.history = metric.history.slice(-this.maxHistoryPoints);
    }
  }

  // ==========================================================================
  // 交易统计
  // ==========================================================================

  /**
   * 记录订单
   */
  public recordOrder(status: 'success' | 'failed' | 'cancelled'): void {
    this.tradingStats.totalOrders++;
    this.tradingStats.lastUpdated = Date.now();

    switch (status) {
      case 'success':
        this.tradingStats.successfulOrders++;
        this.increment('trading_orders_total', 1, { status: 'success' });
        break;
      case 'failed':
        this.tradingStats.failedOrders++;
        this.increment('trading_orders_total', 1, { status: 'failed' });
        break;
      case 'cancelled':
        this.tradingStats.cancelledOrders++;
        this.increment('trading_orders_total', 1, { status: 'cancelled' });
        break;
    }
  }

  /**
   * 记录成交
   */
  public recordTrade(
    volume: Decimal,
    value: Decimal,
    fee: Decimal,
    symbol?: string
  ): void {
    this.tradingStats.totalVolume = this.tradingStats.totalVolume.plus(volume);
    this.tradingStats.totalValue = this.tradingStats.totalValue.plus(value);
    this.tradingStats.totalFees = this.tradingStats.totalFees.plus(fee);
    this.tradingStats.lastUpdated = Date.now();

    // 更新指标
    this.increment('trading_volume', volume.toNumber(), symbol ? { symbol } : undefined);
  }

  /**
   * 更新盈亏
   */
  public updatePnL(realized: Decimal, unrealized: Decimal, symbol?: string): void {
    this.tradingStats.realizedPnL = realized;
    this.tradingStats.unrealizedPnL = unrealized;
    this.tradingStats.totalPnL = realized.plus(unrealized);
    this.tradingStats.lastUpdated = Date.now();

    // 更新指标
    const labels = symbol ? { symbol } : undefined;
    this.set('trading_pnl_realized', realized.toNumber(), labels);
    this.set('trading_pnl_unrealized', unrealized.toNumber(), labels);
  }

  /**
   * 获取交易统计
   */
  public getTradingStats(): TradingStats {
    return { ...this.tradingStats };
  }

  /**
   * 重置交易统计
   */
  public resetTradingStats(): void {
    this.tradingStats = this.createEmptyTradingStats();
    this.logger.info('Trading stats reset');
  }

  // ==========================================================================
  // 系统指标采集
  // ==========================================================================

  /**
   * 采集系统指标
   */
  public collectSystemMetrics(): void {
    // 采集内存使用
    const memUsage = process.memoryUsage();
    this.set('system_memory_used', Math.round(memUsage.heapUsed / 1024 / 1024));
    this.set('system_memory_total', Math.round(memUsage.heapTotal / 1024 / 1024));

    // 采集运行时间
    this.set('system_uptime', Math.round(process.uptime()));

    // 注：CPU 使用率需要更复杂的采集逻辑，这里简化处理
    // 实际应用中可以使用 os-utils 或类似库
  }

  // ==========================================================================
  // 统计计算
  // ==========================================================================

  /**
   * 计算指标平均值
   */
  public average(name: string, duration?: number): number {
    const metric = this.metrics.get(name);
    if (!metric || metric.history.length === 0) {
      return 0;
    }

    // 过滤时间范围
    const cutoff = duration ? Date.now() - duration : 0;
    const points = metric.history.filter(p => p.timestamp >= cutoff);

    if (points.length === 0) {
      return 0;
    }

    // 计算平均值
    const sum = points.reduce((acc, p) => acc + p.value, 0);
    return sum / points.length;
  }

  /**
   * 计算指标最大值
   */
  public max(name: string, duration?: number): number {
    const metric = this.metrics.get(name);
    if (!metric || metric.history.length === 0) {
      return 0;
    }

    // 过滤时间范围
    const cutoff = duration ? Date.now() - duration : 0;
    const points = metric.history.filter(p => p.timestamp >= cutoff);

    if (points.length === 0) {
      return 0;
    }

    // 计算最大值
    return Math.max(...points.map(p => p.value));
  }

  /**
   * 计算指标最小值
   */
  public min(name: string, duration?: number): number {
    const metric = this.metrics.get(name);
    if (!metric || metric.history.length === 0) {
      return 0;
    }

    // 过滤时间范围
    const cutoff = duration ? Date.now() - duration : 0;
    const points = metric.history.filter(p => p.timestamp >= cutoff);

    if (points.length === 0) {
      return 0;
    }

    // 计算最小值
    return Math.min(...points.map(p => p.value));
  }

  /**
   * 计算百分位数
   */
  public percentile(name: string, p: number, duration?: number): number {
    const metric = this.metrics.get(name);
    if (!metric || metric.history.length === 0) {
      return 0;
    }

    // 过滤时间范围
    const cutoff = duration ? Date.now() - duration : 0;
    const points = metric.history.filter(pt => pt.timestamp >= cutoff);

    if (points.length === 0) {
      return 0;
    }

    // 排序
    const values = points.map(pt => pt.value).sort((a, b) => a - b);

    // 计算百分位索引
    const index = Math.ceil((p / 100) * values.length) - 1;
    return values[Math.max(0, index)] ?? 0;
  }

  // ==========================================================================
  // 清理
  // ==========================================================================

  /**
   * 清理所有指标历史
   */
  public clearHistory(): void {
    for (const metric of this.metrics.values()) {
      metric.history = [];
    }
    this.logger.info('Metrics history cleared');
  }

  /**
   * 清理过期数据
   */
  public cleanup(): void {
    const cutoff = Date.now() - this.retention;

    for (const metric of this.metrics.values()) {
      metric.history = metric.history.filter(p => p.timestamp > cutoff);
    }
  }
}
