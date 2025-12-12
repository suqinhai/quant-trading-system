// ============================================================================
// Prometheus 指标收集器
// 提供标准 Prometheus 格式的指标暴露，支持实时 PnL、保证金率、延迟监控
// ============================================================================

import { EventEmitter } from 'eventemitter3';

// ============================================================================
// 类型定义
// ============================================================================

// Prometheus 指标类型
export type PrometheusMetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

// 指标标签
export interface MetricLabels {
  // 标签键值对
  [key: string]: string;
}

// 直方图桶配置
export interface HistogramBuckets {
  // 桶边界值数组
  boundaries: number[];
}

// 指标配置
export interface PrometheusMetricConfig {
  // 指标名称
  name: string;
  // 指标帮助文本
  help: string;
  // 指标类型
  type: PrometheusMetricType;
  // 标签名称列表
  labelNames?: string[];
  // 直方图桶配置（仅 histogram 类型）
  buckets?: number[];
}

// 指标值存储
interface MetricValue {
  // 数值
  value: number;
  // 标签
  labels: MetricLabels;
  // 更新时间
  updatedAt: number;
}

// 直方图数据
interface HistogramData {
  // 各桶计数
  buckets: Map<number, number>;
  // 总和
  sum: number;
  // 计数
  count: number;
  // 标签
  labels: MetricLabels;
}

// PnL 记录
export interface PnlRecord {
  // 时间戳
  timestamp: number;
  // 策略名称
  strategy: string;
  // 交易对
  symbol: string;
  // 已实现盈亏
  realizedPnl: number;
  // 未实现盈亏
  unrealizedPnl: number;
  // 总盈亏
  totalPnl: number;
}

// 保证金率记录
export interface MarginRecord {
  // 时间戳
  timestamp: number;
  // 交易所
  exchange: string;
  // 保证金率（0-1）
  marginRatio: number;
  // 总权益
  totalEquity: number;
  // 总保证金
  totalMargin: number;
  // 总持仓价值
  totalNotional: number;
}

// 延迟记录
export interface LatencyRecord {
  // 时间戳
  timestamp: number;
  // 交易所
  exchange: string;
  // 操作类型
  operation: 'rest' | 'websocket' | 'order' | 'cancel';
  // 延迟（毫秒）
  latencyMs: number;
  // 是否成功
  success: boolean;
}

// API 错误记录
export interface ApiErrorRecord {
  // 时间戳
  timestamp: number;
  // 交易所
  exchange: string;
  // 错误类型
  errorType: string;
  // 错误代码
  errorCode: string;
  // 错误消息
  errorMessage: string;
}

// Prometheus 配置
export interface PrometheusConfig {
  // 指标前缀
  prefix: string;
  // 默认标签
  defaultLabels: MetricLabels;
  // 直方图默认桶
  defaultBuckets: number[];
  // 历史保留时间（毫秒）
  historyRetention: number;
  // 保证金率预警阈值
  marginAlertThresholds: number[];
}

// 默认配置
const DEFAULT_PROMETHEUS_CONFIG: PrometheusConfig = {
  // 指标前缀
  prefix: 'quant_',
  // 默认标签
  defaultLabels: {},
  // 默认直方图桶（延迟：1ms 到 10s）
  defaultBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  // 历史保留 24 小时
  historyRetention: 24 * 60 * 60 * 1000,
  // 保证金率预警阈值：40%, 35%, 30%
  marginAlertThresholds: [0.40, 0.35, 0.30],
};

// 事件类型
export interface PrometheusEvents {
  // 保证金预警
  marginAlert: (exchange: string, ratio: number, threshold: number) => void;
  // 高延迟预警
  latencyAlert: (exchange: string, operation: string, latencyMs: number) => void;
  // API 错误率预警
  errorRateAlert: (exchange: string, errorRate: number) => void;
}

// ============================================================================
// Prometheus 指标收集器类
// ============================================================================

/**
 * Prometheus 指标收集器
 * 提供标准 Prometheus 格式的指标暴露
 */
export class PrometheusCollector extends EventEmitter<PrometheusEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: PrometheusConfig;

  // 指标定义（name -> config）
  private metricConfigs: Map<string, PrometheusMetricConfig> = new Map();

  // Counter 和 Gauge 值存储（name -> labelKey -> value）
  private gaugeValues: Map<string, Map<string, MetricValue>> = new Map();

  // Histogram 数据存储（name -> labelKey -> data）
  private histogramData: Map<string, Map<string, HistogramData>> = new Map();

  // PnL 历史记录
  private pnlHistory: PnlRecord[] = [];

  // 保证金率历史记录
  private marginHistory: MarginRecord[] = [];

  // 延迟历史记录
  private latencyHistory: LatencyRecord[] = [];

  // API 错误历史记录
  private errorHistory: ApiErrorRecord[] = [];

  // API 请求计数（exchange -> { total, errors }）
  private apiRequestCounts: Map<string, { total: number; errors: number }> = new Map();

  // 上次触发的保证金预警（exchange -> threshold）
  private lastMarginAlerts: Map<string, number> = new Map();

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<PrometheusConfig>) {
    // 调用父类构造函数
    super();

    // 合并配置
    this.config = { ...DEFAULT_PROMETHEUS_CONFIG, ...config };

    // 注册内置指标
    this.registerBuiltInMetrics();
  }

  // ========================================================================
  // 私有方法 - 初始化
  // ========================================================================

  /**
   * 注册内置指标
   */
  private registerBuiltInMetrics(): void {
    // === PnL 指标 ===
    // 已实现盈亏
    this.registerMetric({
      name: 'pnl_realized',
      help: '已实现盈亏（USDT）',
      type: 'gauge',
      labelNames: ['strategy', 'symbol'],
    });

    // 未实现盈亏
    this.registerMetric({
      name: 'pnl_unrealized',
      help: '未实现盈亏（USDT）',
      type: 'gauge',
      labelNames: ['strategy', 'symbol'],
    });

    // 总盈亏
    this.registerMetric({
      name: 'pnl_total',
      help: '总盈亏（USDT）',
      type: 'gauge',
      labelNames: ['strategy', 'symbol'],
    });

    // === 保证金指标 ===
    // 保证金率
    this.registerMetric({
      name: 'margin_ratio',
      help: '保证金率（0-1）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // 总权益
    this.registerMetric({
      name: 'equity_total',
      help: '总权益（USDT）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // 总保证金
    this.registerMetric({
      name: 'margin_total',
      help: '总保证金（USDT）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // 总持仓价值
    this.registerMetric({
      name: 'notional_total',
      help: '总持仓价值（USDT）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // 保证金预警状态
    this.registerMetric({
      name: 'margin_alert_status',
      help: '保证金预警状态（0=正常, 1=40%预警, 2=35%预警, 3=30%预警）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // === 延迟指标 ===
    // API 延迟直方图
    this.registerMetric({
      name: 'api_latency_seconds',
      help: 'API 请求延迟（秒）',
      type: 'histogram',
      labelNames: ['exchange', 'operation'],
      buckets: this.config.defaultBuckets.map(ms => ms / 1000), // 转换为秒
    });

    // 当前延迟
    this.registerMetric({
      name: 'api_latency_current_ms',
      help: '当前 API 延迟（毫秒）',
      type: 'gauge',
      labelNames: ['exchange', 'operation'],
    });

    // === API 错误指标 ===
    // API 请求总数
    this.registerMetric({
      name: 'api_requests_total',
      help: 'API 请求总数',
      type: 'counter',
      labelNames: ['exchange', 'operation', 'status'],
    });

    // API 错误总数
    this.registerMetric({
      name: 'api_errors_total',
      help: 'API 错误总数',
      type: 'counter',
      labelNames: ['exchange', 'error_type', 'error_code'],
    });

    // 当前错误率
    this.registerMetric({
      name: 'api_error_rate',
      help: '当前 API 错误率（0-1）',
      type: 'gauge',
      labelNames: ['exchange'],
    });

    // === 交易指标 ===
    // 订单总数
    this.registerMetric({
      name: 'orders_total',
      help: '订单总数',
      type: 'counter',
      labelNames: ['exchange', 'symbol', 'side', 'status'],
    });

    // 成交量
    this.registerMetric({
      name: 'trade_volume_total',
      help: '总成交量',
      type: 'counter',
      labelNames: ['exchange', 'symbol'],
    });

    // 手续费
    this.registerMetric({
      name: 'fees_total',
      help: '总手续费（USDT）',
      type: 'counter',
      labelNames: ['exchange', 'symbol'],
    });

    // === 策略指标 ===
    // 策略运行状态
    this.registerMetric({
      name: 'strategy_running',
      help: '策略运行状态（0=停止, 1=运行）',
      type: 'gauge',
      labelNames: ['strategy'],
    });

    // 策略夏普比率
    this.registerMetric({
      name: 'strategy_sharpe_ratio',
      help: '策略夏普比率',
      type: 'gauge',
      labelNames: ['strategy'],
    });

    // 策略最大回撤
    this.registerMetric({
      name: 'strategy_max_drawdown',
      help: '策略最大回撤（0-1）',
      type: 'gauge',
      labelNames: ['strategy'],
    });

    // 策略胜率
    this.registerMetric({
      name: 'strategy_win_rate',
      help: '策略胜率（0-1）',
      type: 'gauge',
      labelNames: ['strategy'],
    });

    // === 系统指标 ===
    // 进程内存使用
    this.registerMetric({
      name: 'process_memory_bytes',
      help: '进程内存使用（字节）',
      type: 'gauge',
      labelNames: ['type'],
    });

    // 进程 CPU 使用
    this.registerMetric({
      name: 'process_cpu_seconds_total',
      help: '进程 CPU 使用时间（秒）',
      type: 'counter',
      labelNames: [],
    });

    // 运行时间
    this.registerMetric({
      name: 'process_uptime_seconds',
      help: '进程运行时间（秒）',
      type: 'gauge',
      labelNames: [],
    });
  }

  // ========================================================================
  // 公共方法 - 指标注册
  // ========================================================================

  /**
   * 注册指标
   * @param config - 指标配置
   */
  registerMetric(config: PrometheusMetricConfig): void {
    // 添加前缀
    const fullName = this.config.prefix + config.name;

    // 保存配置
    this.metricConfigs.set(fullName, {
      ...config,
      name: fullName,
    });

    // 初始化存储
    if (config.type === 'histogram') {
      // 初始化直方图存储
      this.histogramData.set(fullName, new Map());
    } else {
      // 初始化 Gauge/Counter 存储
      this.gaugeValues.set(fullName, new Map());
    }
  }

  // ========================================================================
  // 公共方法 - 指标更新
  // ========================================================================

  /**
   * 设置 Gauge 值
   * @param name - 指标名称（不含前缀）
   * @param value - 值
   * @param labels - 标签
   */
  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    // 获取完整名称
    const fullName = this.config.prefix + name;

    // 获取存储
    const storage = this.gaugeValues.get(fullName);

    // 如果存储不存在，忽略
    if (!storage) {
      return;
    }

    // 生成标签键
    const labelKey = this.getLabelKey(labels);

    // 保存值
    storage.set(labelKey, {
      value,
      labels: { ...this.config.defaultLabels, ...labels },
      updatedAt: Date.now(),
    });
  }

  /**
   * 增加 Counter 值
   * @param name - 指标名称（不含前缀）
   * @param value - 增加量
   * @param labels - 标签
   */
  incCounter(name: string, value: number = 1, labels: MetricLabels = {}): void {
    // 获取完整名称
    const fullName = this.config.prefix + name;

    // 获取存储
    const storage = this.gaugeValues.get(fullName);

    // 如果存储不存在，忽略
    if (!storage) {
      return;
    }

    // 生成标签键
    const labelKey = this.getLabelKey(labels);

    // 获取当前值
    const current = storage.get(labelKey);

    // 更新值
    storage.set(labelKey, {
      value: (current?.value ?? 0) + value,
      labels: { ...this.config.defaultLabels, ...labels },
      updatedAt: Date.now(),
    });
  }

  /**
   * 观察 Histogram 值
   * @param name - 指标名称（不含前缀）
   * @param value - 观察值
   * @param labels - 标签
   */
  observeHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    // 获取完整名称
    const fullName = this.config.prefix + name;

    // 获取配置
    const config = this.metricConfigs.get(fullName);

    // 如果配置不存在，忽略
    if (!config || config.type !== 'histogram') {
      return;
    }

    // 获取存储
    const storage = this.histogramData.get(fullName);

    // 如果存储不存在，忽略
    if (!storage) {
      return;
    }

    // 生成标签键
    const labelKey = this.getLabelKey(labels);

    // 获取或创建数据
    let data = storage.get(labelKey);

    // 如果数据不存在，创建新数据
    if (!data) {
      // 初始化桶
      const buckets = new Map<number, number>();

      // 使用配置的桶或默认桶
      const boundaries = config.buckets ?? this.config.defaultBuckets;

      // 初始化所有桶为 0
      for (const boundary of boundaries) {
        buckets.set(boundary, 0);
      }

      // 添加 +Inf 桶
      buckets.set(Infinity, 0);

      // 创建数据
      data = {
        buckets,
        sum: 0,
        count: 0,
        labels: { ...this.config.defaultLabels, ...labels },
      };

      // 保存数据
      storage.set(labelKey, data);
    }

    // 更新桶计数
    for (const [boundary, count] of data.buckets) {
      // 如果值小于等于边界，增加计数
      if (value <= boundary) {
        data.buckets.set(boundary, count + 1);
      }
    }

    // 更新总和和计数
    data.sum += value;
    data.count++;
  }

  // ========================================================================
  // 公共方法 - PnL 记录
  // ========================================================================

  /**
   * 记录 PnL
   * @param record - PnL 记录
   */
  recordPnl(record: PnlRecord): void {
    // 添加到历史
    this.pnlHistory.push(record);

    // 清理过期记录
    this.cleanupHistory();

    // 更新指标
    const labels = {
      strategy: record.strategy,
      symbol: record.symbol,
    };

    // 设置已实现盈亏
    this.setGauge('pnl_realized', record.realizedPnl, labels);

    // 设置未实现盈亏
    this.setGauge('pnl_unrealized', record.unrealizedPnl, labels);

    // 设置总盈亏
    this.setGauge('pnl_total', record.totalPnl, labels);
  }

  /**
   * 获取 PnL 历史
   * @param strategy - 策略名称（可选）
   * @param symbol - 交易对（可选）
   * @param since - 起始时间（可选）
   */
  getPnlHistory(strategy?: string, symbol?: string, since?: number): PnlRecord[] {
    // 过滤历史记录
    return this.pnlHistory.filter((record) => {
      // 检查策略
      if (strategy && record.strategy !== strategy) {
        return false;
      }

      // 检查交易对
      if (symbol && record.symbol !== symbol) {
        return false;
      }

      // 检查时间
      if (since && record.timestamp < since) {
        return false;
      }

      return true;
    });
  }

  // ========================================================================
  // 公共方法 - 保证金率记录
  // ========================================================================

  /**
   * 记录保证金率
   * @param record - 保证金率记录
   */
  recordMargin(record: MarginRecord): void {
    // 添加到历史
    this.marginHistory.push(record);

    // 清理过期记录
    this.cleanupHistory();

    // 更新指标
    const labels = { exchange: record.exchange };

    // 设置保证金率
    this.setGauge('margin_ratio', record.marginRatio, labels);

    // 设置总权益
    this.setGauge('equity_total', record.totalEquity, labels);

    // 设置总保证金
    this.setGauge('margin_total', record.totalMargin, labels);

    // 设置总持仓价值
    this.setGauge('notional_total', record.totalNotional, labels);

    // 检查预警
    this.checkMarginAlert(record);
  }

  /**
   * 检查保证金预警
   * @param record - 保证金率记录
   */
  private checkMarginAlert(record: MarginRecord): void {
    // 获取预警阈值
    const thresholds = this.config.marginAlertThresholds;

    // 按阈值降序排序
    const sortedThresholds = [...thresholds].sort((a, b) => b - a);

    // 确定当前预警级别
    let alertLevel = 0;
    let triggeredThreshold = 0;

    // 遍历阈值
    for (let i = 0; i < sortedThresholds.length; i++) {
      // 获取阈值
      const threshold = sortedThresholds[i]!;

      // 如果保证金率低于阈值
      if (record.marginRatio < threshold) {
        // 设置预警级别（1, 2, 3...）
        alertLevel = i + 1;
        triggeredThreshold = threshold;
      }
    }

    // 设置预警状态指标
    this.setGauge('margin_alert_status', alertLevel, { exchange: record.exchange });

    // 获取上次预警阈值
    const lastThreshold = this.lastMarginAlerts.get(record.exchange) ?? 1;

    // 如果触发了新的预警（比上次更严重）
    if (triggeredThreshold > 0 && triggeredThreshold < lastThreshold) {
      // 触发预警事件
      this.emit('marginAlert', record.exchange, record.marginRatio, triggeredThreshold);

      // 更新上次预警阈值
      this.lastMarginAlerts.set(record.exchange, triggeredThreshold);
    }

    // 如果恢复正常
    if (alertLevel === 0 && lastThreshold < 1) {
      // 重置上次预警阈值
      this.lastMarginAlerts.set(record.exchange, 1);
    }
  }

  /**
   * 获取保证金率历史
   * @param exchange - 交易所（可选）
   * @param since - 起始时间（可选）
   */
  getMarginHistory(exchange?: string, since?: number): MarginRecord[] {
    // 过滤历史记录
    return this.marginHistory.filter((record) => {
      // 检查交易所
      if (exchange && record.exchange !== exchange) {
        return false;
      }

      // 检查时间
      if (since && record.timestamp < since) {
        return false;
      }

      return true;
    });
  }

  // ========================================================================
  // 公共方法 - 延迟记录
  // ========================================================================

  /**
   * 记录延迟
   * @param record - 延迟记录
   */
  recordLatency(record: LatencyRecord): void {
    // 添加到历史
    this.latencyHistory.push(record);

    // 清理过期记录
    this.cleanupHistory();

    // 更新指标
    const labels = {
      exchange: record.exchange,
      operation: record.operation,
    };

    // 记录到直方图（转换为秒）
    this.observeHistogram('api_latency_seconds', record.latencyMs / 1000, labels);

    // 设置当前延迟
    this.setGauge('api_latency_current_ms', record.latencyMs, labels);

    // 增加请求计数
    this.incCounter('api_requests_total', 1, {
      ...labels,
      status: record.success ? 'success' : 'error',
    });

    // 更新 API 请求统计
    this.updateApiRequestStats(record.exchange, record.success);

    // 检查高延迟预警（超过 1 秒）
    if (record.latencyMs > 1000) {
      // 触发预警事件
      this.emit('latencyAlert', record.exchange, record.operation, record.latencyMs);
    }
  }

  /**
   * 更新 API 请求统计
   * @param exchange - 交易所
   * @param success - 是否成功
   */
  private updateApiRequestStats(exchange: string, success: boolean): void {
    // 获取或创建统计
    let stats = this.apiRequestCounts.get(exchange);

    // 如果统计不存在，创建新统计
    if (!stats) {
      stats = { total: 0, errors: 0 };
      this.apiRequestCounts.set(exchange, stats);
    }

    // 更新统计
    stats.total++;

    // 如果失败，增加错误计数
    if (!success) {
      stats.errors++;
    }

    // 计算错误率
    const errorRate = stats.errors / stats.total;

    // 设置错误率指标
    this.setGauge('api_error_rate', errorRate, { exchange });

    // 检查错误率预警（超过 10%）
    if (errorRate > 0.1 && stats.total >= 10) {
      // 触发预警事件
      this.emit('errorRateAlert', exchange, errorRate);
    }
  }

  /**
   * 获取延迟历史
   * @param exchange - 交易所（可选）
   * @param operation - 操作类型（可选）
   * @param since - 起始时间（可选）
   */
  getLatencyHistory(
    exchange?: string,
    operation?: string,
    since?: number
  ): LatencyRecord[] {
    // 过滤历史记录
    return this.latencyHistory.filter((record) => {
      // 检查交易所
      if (exchange && record.exchange !== exchange) {
        return false;
      }

      // 检查操作类型
      if (operation && record.operation !== operation) {
        return false;
      }

      // 检查时间
      if (since && record.timestamp < since) {
        return false;
      }

      return true;
    });
  }

  // ========================================================================
  // 公共方法 - API 错误记录
  // ========================================================================

  /**
   * 记录 API 错误
   * @param record - API 错误记录
   */
  recordApiError(record: ApiErrorRecord): void {
    // 添加到历史
    this.errorHistory.push(record);

    // 清理过期记录
    this.cleanupHistory();

    // 增加错误计数
    this.incCounter('api_errors_total', 1, {
      exchange: record.exchange,
      error_type: record.errorType,
      error_code: record.errorCode,
    });
  }

  /**
   * 获取 API 错误历史
   * @param exchange - 交易所（可选）
   * @param since - 起始时间（可选）
   */
  getErrorHistory(exchange?: string, since?: number): ApiErrorRecord[] {
    // 过滤历史记录
    return this.errorHistory.filter((record) => {
      // 检查交易所
      if (exchange && record.exchange !== exchange) {
        return false;
      }

      // 检查时间
      if (since && record.timestamp < since) {
        return false;
      }

      return true;
    });
  }

  // ========================================================================
  // 公共方法 - 系统指标
  // ========================================================================

  /**
   * 采集系统指标
   */
  collectSystemMetrics(): void {
    // 获取内存使用
    const memUsage = process.memoryUsage();

    // 设置内存指标
    this.setGauge('process_memory_bytes', memUsage.heapUsed, { type: 'heap_used' });
    this.setGauge('process_memory_bytes', memUsage.heapTotal, { type: 'heap_total' });
    this.setGauge('process_memory_bytes', memUsage.rss, { type: 'rss' });
    this.setGauge('process_memory_bytes', memUsage.external, { type: 'external' });

    // 获取 CPU 使用
    const cpuUsage = process.cpuUsage();

    // 设置 CPU 指标（转换为秒）
    this.setGauge(
      'process_cpu_seconds_total',
      (cpuUsage.user + cpuUsage.system) / 1000000
    );

    // 设置运行时间
    this.setGauge('process_uptime_seconds', process.uptime());
  }

  // ========================================================================
  // 公共方法 - 指标输出
  // ========================================================================

  /**
   * 生成 Prometheus 格式的指标输出
   */
  getMetrics(): string {
    // 结果数组
    const lines: string[] = [];

    // 采集系统指标
    this.collectSystemMetrics();

    // 遍历所有指标配置
    for (const [fullName, config] of this.metricConfigs) {
      // 添加帮助文本
      lines.push(`# HELP ${fullName} ${config.help}`);

      // 添加类型声明
      lines.push(`# TYPE ${fullName} ${config.type}`);

      // 根据类型输出指标值
      if (config.type === 'histogram') {
        // 输出直方图
        this.outputHistogram(fullName, lines);
      } else {
        // 输出 Gauge/Counter
        this.outputGaugeOrCounter(fullName, lines);
      }

      // 添加空行
      lines.push('');
    }

    // 返回结果
    return lines.join('\n');
  }

  /**
   * 输出 Gauge 或 Counter 指标
   * @param fullName - 完整指标名称
   * @param lines - 输出行数组
   */
  private outputGaugeOrCounter(fullName: string, lines: string[]): void {
    // 获取存储
    const storage = this.gaugeValues.get(fullName);

    // 如果存储不存在，跳过
    if (!storage) {
      return;
    }

    // 遍历所有值
    for (const metricValue of storage.values()) {
      // 生成标签字符串
      const labelStr = this.formatLabels(metricValue.labels);

      // 添加指标行
      if (labelStr) {
        lines.push(`${fullName}{${labelStr}} ${metricValue.value}`);
      } else {
        lines.push(`${fullName} ${metricValue.value}`);
      }
    }
  }

  /**
   * 输出直方图指标
   * @param fullName - 完整指标名称
   * @param lines - 输出行数组
   */
  private outputHistogram(fullName: string, lines: string[]): void {
    // 获取存储
    const storage = this.histogramData.get(fullName);

    // 如果存储不存在，跳过
    if (!storage) {
      return;
    }

    // 遍历所有数据
    for (const data of storage.values()) {
      // 生成基础标签字符串
      const baseLabels = this.formatLabels(data.labels);

      // 输出桶
      for (const [boundary, count] of data.buckets) {
        // 生成桶标签
        const le = boundary === Infinity ? '+Inf' : boundary.toString();
        const bucketLabels = baseLabels ? `${baseLabels},le="${le}"` : `le="${le}"`;

        // 添加桶行
        lines.push(`${fullName}_bucket{${bucketLabels}} ${count}`);
      }

      // 输出总和
      if (baseLabels) {
        lines.push(`${fullName}_sum{${baseLabels}} ${data.sum}`);
        lines.push(`${fullName}_count{${baseLabels}} ${data.count}`);
      } else {
        lines.push(`${fullName}_sum ${data.sum}`);
        lines.push(`${fullName}_count ${data.count}`);
      }
    }
  }

  // ========================================================================
  // 公共方法 - 统计查询
  // ========================================================================

  /**
   * 获取延迟统计
   * @param exchange - 交易所
   * @param operation - 操作类型
   * @param duration - 统计时长（毫秒）
   */
  getLatencyStats(
    exchange: string,
    operation: string,
    duration: number = 60000
  ): {
    avg: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  } {
    // 获取时间范围内的记录
    const since = Date.now() - duration;
    const records = this.getLatencyHistory(exchange, operation, since);

    // 如果没有记录，返回零值
    if (records.length === 0) {
      return { avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, count: 0 };
    }

    // 提取延迟值并排序
    const latencies = records.map((r) => r.latencyMs).sort((a, b) => a - b);

    // 计算统计值
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;
    const min = latencies[0]!;
    const max = latencies[latencies.length - 1]!;

    // 计算百分位数
    const p50 = this.percentile(latencies, 50);
    const p95 = this.percentile(latencies, 95);
    const p99 = this.percentile(latencies, 99);

    return {
      avg,
      min,
      max,
      p50,
      p95,
      p99,
      count: latencies.length,
    };
  }

  /**
   * 计算百分位数
   * @param sortedValues - 已排序的值数组
   * @param percentile - 百分位（0-100）
   */
  private percentile(sortedValues: number[], percentile: number): number {
    // 计算索引
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;

    // 返回值
    return sortedValues[Math.max(0, index)] ?? 0;
  }

  /**
   * 获取 API 错误率
   * @param exchange - 交易所
   */
  getErrorRate(exchange: string): number {
    // 获取统计
    const stats = this.apiRequestCounts.get(exchange);

    // 如果统计不存在，返回 0
    if (!stats || stats.total === 0) {
      return 0;
    }

    // 返回错误率
    return stats.errors / stats.total;
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 生成标签键
   * @param labels - 标签
   */
  private getLabelKey(labels: MetricLabels): string {
    // 排序标签键
    const keys = Object.keys(labels).sort();

    // 生成键字符串
    return keys.map((k) => `${k}=${labels[k]}`).join(',');
  }

  /**
   * 格式化标签为 Prometheus 格式
   * @param labels - 标签
   */
  private formatLabels(labels: MetricLabels): string {
    // 获取标签条目
    const entries = Object.entries(labels);

    // 如果没有标签，返回空字符串
    if (entries.length === 0) {
      return '';
    }

    // 格式化每个标签
    return entries.map(([k, v]) => `${k}="${v}"`).join(',');
  }

  /**
   * 清理过期历史记录
   */
  private cleanupHistory(): void {
    // 计算截止时间
    const cutoff = Date.now() - this.config.historyRetention;

    // 清理 PnL 历史
    this.pnlHistory = this.pnlHistory.filter((r) => r.timestamp > cutoff);

    // 清理保证金率历史
    this.marginHistory = this.marginHistory.filter((r) => r.timestamp > cutoff);

    // 清理延迟历史
    this.latencyHistory = this.latencyHistory.filter((r) => r.timestamp > cutoff);

    // 清理错误历史
    this.errorHistory = this.errorHistory.filter((r) => r.timestamp > cutoff);
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    // 清空所有存储
    for (const storage of this.gaugeValues.values()) {
      storage.clear();
    }

    // 清空直方图数据
    for (const storage of this.histogramData.values()) {
      storage.clear();
    }

    // 清空历史
    this.pnlHistory = [];
    this.marginHistory = [];
    this.latencyHistory = [];
    this.errorHistory = [];

    // 清空 API 统计
    this.apiRequestCounts.clear();

    // 清空预警记录
    this.lastMarginAlerts.clear();
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建 Prometheus 收集器
 * @param config - 配置
 */
export function createPrometheusCollector(
  config?: Partial<PrometheusConfig>
): PrometheusCollector {
  return new PrometheusCollector(config);
}

// 导出默认配置
export { DEFAULT_PROMETHEUS_CONFIG };
