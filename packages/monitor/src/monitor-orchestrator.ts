// ============================================================================
// 监控协调器
// 整合 Prometheus、Telegram、每日报告等组件，提供统一的监控接口
// ============================================================================

import { EventEmitter } from 'eventemitter3';
import {
  PrometheusCollector,
  createPrometheusCollector,
  type PrometheusConfig,
  type PnlRecord,
  type MarginRecord,
  type LatencyRecord,
  type ApiErrorRecord,
} from './prometheus';
import {
  TelegramBot,
  createTelegramBot,
  type TelegramBotConfig,
  type DataProvider,
  type PerformanceReport,
  type ExchangeMarginRatio,
  type ApiStats,
} from './telegram-bot';
import {
  DailyReportGenerator,
  createDailyReportGenerator,
  type ReportGeneratorConfig,
  type TradeRecord,
} from './daily-report';
import {
  GrafanaDashboardGenerator,
  createGrafanaDashboardGenerator,
  type DashboardGeneratorConfig,
  type GrafanaDashboard,
} from './grafana-dashboards';

// ============================================================================
// 类型定义
// ============================================================================

// 监控协调器配置
export interface MonitorOrchestratorConfig {
  // Prometheus 配置
  prometheus: Partial<PrometheusConfig>;
  // Telegram 配置
  telegram: Partial<TelegramBotConfig>;
  // 报告生成器配置
  report: Partial<ReportGeneratorConfig>;
  // Grafana 仪表盘配置
  grafana: Partial<DashboardGeneratorConfig>;
  // 是否启用 Prometheus
  enablePrometheus: boolean;
  // 是否启用 Telegram
  enableTelegram: boolean;
  // 是否启用每日报告
  enableDailyReport: boolean;
  // 指标采集间隔（毫秒）
  metricsInterval: number;
  // HTTP 服务端口（用于 Prometheus 抓取）
  httpPort: number;
}

// 默认配置
const DEFAULT_ORCHESTRATOR_CONFIG: MonitorOrchestratorConfig = {
  // Prometheus 默认配置
  prometheus: {},
  // Telegram 默认配置
  telegram: {},
  // 报告默认配置
  report: {},
  // Grafana 默认配置
  grafana: {},
  // 启用 Prometheus
  enablePrometheus: true,
  // 启用 Telegram
  enableTelegram: true,
  // 启用每日报告
  enableDailyReport: true,
  // 采集间隔 5 秒
  metricsInterval: 5000,
  // HTTP 端口 9090
  httpPort: 9090,
};

// 持仓信息
export interface PositionData {
  // 交易所
  exchange: string;
  // 交易对
  symbol: string;
  // 方向
  side: string;
  // 数量
  quantity: number;
  // 开仓均价
  entryPrice: number;
  // 未实现盈亏
  unrealizedPnl: number;
}

// 延迟统计
export interface LatencyStats {
  // 交易所
  exchange: string;
  // 平均延迟
  avgLatency: number;
  // P95 延迟
  p95Latency: number;
  // P99 延迟
  p99Latency: number;
}

// 事件类型
export interface MonitorEvents {
  // 指标已更新
  metricsUpdated: () => void;
  // 告警触发
  alertTriggered: (type: string, message: string) => void;
  // 每日报告生成
  dailyReportGenerated: (report: PerformanceReport) => void;
  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 监控协调器类
// ============================================================================

/**
 * 监控协调器
 * 整合所有监控组件，提供统一接口
 */
export class MonitorOrchestrator extends EventEmitter<MonitorEvents> implements DataProvider {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: MonitorOrchestratorConfig;

  // Prometheus 收集器
  private prometheus: PrometheusCollector;

  // Telegram 机器人
  private telegram: TelegramBot;

  // 每日报告生成器
  private reportGenerator: DailyReportGenerator;

  // Grafana 仪表盘生成器
  private grafanaGenerator: GrafanaDashboardGenerator;

  // 是否正在运行
  private running: boolean = false;

  // 指标采集定时器
  private metricsTimer: ReturnType<typeof setInterval> | null = null;

  // HTTP 服务器引用
  private httpServer: unknown = null;

  // 当前权益
  private currentEquity: number = 0;

  // 当日起始权益
  private dailyStartEquity: number = 0;

  // 当日峰值权益
  private dailyPeakEquity: number = 0;

  // 累计起始权益
  private cumulativeStartEquity: number = 0;

  // 启动时间
  private startTime: number = 0;

  // 活跃策略数
  private activeStrategies: number = 0;

  // 活跃连接数
  private activeConnections: number = 0;

  // 持仓数据
  private positions: Map<string, PositionData> = new Map();

  // 策略暂停回调
  private pauseCallback: ((reason: string) => void) | null = null;

  // 策略恢复回调
  private resumeCallback: (() => void) | null = null;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<MonitorOrchestratorConfig>) {
    // 调用父类构造函数
    super();

    // 合并配置
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };

    // 创建组件
    this.prometheus = createPrometheusCollector(this.config.prometheus);
    this.telegram = createTelegramBot(this.config.telegram);
    this.reportGenerator = createDailyReportGenerator(this.config.report);
    this.grafanaGenerator = createGrafanaDashboardGenerator(this.config.grafana);

    // 设置事件监听
    this.setupEventListeners();
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动监控
   * @param initialEquity - 初始权益
   */
  async start(initialEquity: number): Promise<void> {
    // 设置运行状态
    this.running = true;
    this.startTime = Date.now();

    // 初始化权益
    this.currentEquity = initialEquity;
    this.dailyStartEquity = initialEquity;
    this.dailyPeakEquity = initialEquity;
    this.cumulativeStartEquity = initialEquity;

    // 初始化报告生成器
    this.reportGenerator.initialize(initialEquity);

    // 启动 Telegram 机器人
    if (this.config.enableTelegram) {
      this.telegram.start(this);
    }

    // 启动 HTTP 服务（用于 Prometheus 抓取）
    if (this.config.enablePrometheus) {
      await this.startHttpServer();
    }

    // 启动指标采集定时器
    this.startMetricsTimer();

    // 发出启动事件
    this.emit('metricsUpdated');
  }

  /**
   * 停止监控
   */
  async stop(): Promise<void> {
    // 设置运行状态
    this.running = false;

    // 停止 Telegram 机器人
    this.telegram.stop();

    // 停止 HTTP 服务
    await this.stopHttpServer();

    // 停止指标采集定时器
    this.stopMetricsTimer();
  }

  /**
   * 重置监控
   */
  reset(): void {
    // 停止
    this.stop();

    // 重置组件
    this.prometheus.reset();
    this.telegram.reset();
    this.reportGenerator.reset();

    // 重置数据
    this.currentEquity = 0;
    this.dailyStartEquity = 0;
    this.dailyPeakEquity = 0;
    this.cumulativeStartEquity = 0;
    this.positions.clear();
  }

  // ========================================================================
  // 公共方法 - 数据更新
  // ========================================================================

  /**
   * 更新权益
   * @param equity - 当前权益
   */
  updateEquity(equity: number): void {
    // 保存权益
    this.currentEquity = equity;

    // 更新峰值
    if (equity > this.dailyPeakEquity) {
      this.dailyPeakEquity = equity;
    }

    // 记录到报告生成器
    this.reportGenerator.recordEquity(equity);

    // 更新 Prometheus 指标
    const dailyPnl = equity - this.dailyStartEquity;
    this.prometheus.recordPnl({
      timestamp: Date.now(),
      strategy: 'total',
      symbol: 'ALL',
      realizedPnl: dailyPnl,
      unrealizedPnl: 0,
      totalPnl: dailyPnl,
    });
  }

  /**
   * 记录 PnL
   * @param record - PnL 记录
   */
  recordPnl(record: PnlRecord): void {
    // 记录到 Prometheus
    this.prometheus.recordPnl(record);

    // 记录到报告生成器
    this.reportGenerator.recordStrategyPnl(record.strategy, record.totalPnl, record.timestamp);
  }

  /**
   * 记录保证金率
   * @param record - 保证金率记录
   */
  recordMargin(record: MarginRecord): void {
    // 记录到 Prometheus
    this.prometheus.recordMargin(record);

    // 记录到报告生成器
    this.reportGenerator.recordMarginRatio(
      record.exchange,
      record.marginRatio,
      record.timestamp
    );
  }

  /**
   * 记录延迟
   * @param record - 延迟记录
   */
  recordLatency(record: LatencyRecord): void {
    // 记录到 Prometheus
    this.prometheus.recordLatency(record);

    // 记录到报告生成器
    this.reportGenerator.recordLatency(
      record.exchange,
      record.latencyMs,
      record.timestamp
    );
  }

  /**
   * 记录 API 错误
   * @param record - API 错误记录
   */
  recordApiError(record: ApiErrorRecord): void {
    // 记录到 Prometheus
    this.prometheus.recordApiError(record);
  }

  /**
   * 记录交易
   * @param trade - 交易记录
   */
  recordTrade(trade: TradeRecord): void {
    // 记录到报告生成器
    this.reportGenerator.recordTrade(trade);

    // 更新 Prometheus 订单指标
    this.prometheus.incCounter('orders_total', 1, {
      exchange: 'all',
      symbol: trade.symbol,
      side: trade.side,
      status: 'filled',
    });
  }

  /**
   * 更新持仓
   * @param position - 持仓数据
   */
  updatePosition(position: PositionData): void {
    // 生成键
    const key = `${position.exchange}:${position.symbol}`;

    // 保存持仓
    if (position.quantity > 0) {
      this.positions.set(key, position);
    } else {
      this.positions.delete(key);
    }
  }

  /**
   * 设置策略回调
   * @param pauseCallback - 暂停回调
   * @param resumeCallback - 恢复回调
   */
  setStrategyCallbacks(
    pauseCallback: (reason: string) => void,
    resumeCallback: () => void
  ): void {
    this.pauseCallback = pauseCallback;
    this.resumeCallback = resumeCallback;
  }

  /**
   * 设置活跃策略数
   * @param count - 数量
   */
  setActiveStrategies(count: number): void {
    this.activeStrategies = count;
  }

  /**
   * 设置活跃连接数
   * @param count - 数量
   */
  setActiveConnections(count: number): void {
    this.activeConnections = count;
  }

  // ========================================================================
  // 公共方法 - 查询
  // ========================================================================

  /**
   * 获取 Prometheus 指标输出
   */
  getPrometheusMetrics(): string {
    return this.prometheus.getMetrics();
  }

  /**
   * 生成 Grafana 仪表盘
   */
  generateGrafanaDashboards(): Map<string, GrafanaDashboard> {
    return this.grafanaGenerator.generateAllDashboards();
  }

  /**
   * 导出 Grafana 仪表盘为 JSON
   * @param dashboard - 仪表盘配置
   */
  exportGrafanaDashboard(dashboard: GrafanaDashboard): string {
    return this.grafanaGenerator.exportToJson(dashboard);
  }

  /**
   * 生成 PnL 曲线图 SVG
   * @param title - 标题
   * @param timeRange - 时间范围（小时）
   */
  generatePnlChartSvg(title?: string, timeRange?: number): string {
    return this.reportGenerator.generatePnlChartSvg(title, timeRange);
  }

  /**
   * 生成保证金率图 SVG
   * @param title - 标题
   * @param timeRange - 时间范围（小时）
   */
  generateMarginChartSvg(title?: string, timeRange?: number): string {
    return this.reportGenerator.generateMarginChartSvg(title, timeRange);
  }

  /**
   * 获取 Prometheus 收集器
   */
  getPrometheusCollector(): PrometheusCollector {
    return this.prometheus;
  }

  /**
   * 获取 Telegram 机器人
   */
  getTelegramBot(): TelegramBot {
    return this.telegram;
  }

  /**
   * 获取报告生成器
   */
  getReportGenerator(): DailyReportGenerator {
    return this.reportGenerator;
  }

  // ========================================================================
  // 实现 DataProvider 接口
  // ========================================================================

  /**
   * 获取系统状态
   */
  async getSystemStatus(): Promise<{
    running: boolean;
    uptime: number;
    memoryUsage: number;
    activeConnections: number;
    activeStrategies: number;
  }> {
    // 获取内存使用
    const memUsage = process.memoryUsage();

    return {
      running: this.running,
      uptime: this.startTime > 0 ? (Date.now() - this.startTime) / 1000 : 0,
      memoryUsage: memUsage.heapUsed,
      activeConnections: this.activeConnections,
      activeStrategies: this.activeStrategies,
    };
  }

  /**
   * 获取当前 PnL
   */
  async getCurrentPnl(): Promise<{
    totalEquity: number;
    dailyPnl: number;
    dailyReturn: number;
    cumulativePnl: number;
    dailyDrawdown: number;
  }> {
    // 计算各项数据
    const dailyPnl = this.currentEquity - this.dailyStartEquity;
    const dailyReturn = this.dailyStartEquity > 0
      ? dailyPnl / this.dailyStartEquity
      : 0;
    const cumulativePnl = this.currentEquity - this.cumulativeStartEquity;
    const dailyDrawdown = this.dailyPeakEquity > 0
      ? 1 - this.currentEquity / this.dailyPeakEquity
      : 0;

    return {
      totalEquity: this.currentEquity,
      dailyPnl,
      dailyReturn,
      cumulativePnl,
      dailyDrawdown,
    };
  }

  /**
   * 获取保证金率
   */
  async getMarginRatios(): Promise<ExchangeMarginRatio[]> {
    // 从 Prometheus 获取最新保证金率
    const marginHistory = this.prometheus.getMarginHistory();

    // 按交易所分组，取最新值
    const latestByExchange = new Map<string, MarginRecord>();

    for (const record of marginHistory) {
      const existing = latestByExchange.get(record.exchange);
      if (!existing || record.timestamp > existing.timestamp) {
        latestByExchange.set(record.exchange, record);
      }
    }

    // 转换为结果格式
    const result: ExchangeMarginRatio[] = [];

    for (const record of latestByExchange.values()) {
      result.push({
        exchange: record.exchange,
        marginRatio: record.marginRatio,
        totalEquity: record.totalEquity,
      });
    }

    return result;
  }

  /**
   * 获取持仓
   */
  async getPositions(): Promise<Array<{
    exchange: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    unrealizedPnl: number;
  }>> {
    return Array.from(this.positions.values());
  }

  /**
   * 获取延迟统计
   */
  async getLatencyStats(): Promise<LatencyStats[]> {
    // 获取延迟历史
    const latencyHistory = this.prometheus.getLatencyHistory();

    // 按交易所分组
    const byExchange = new Map<string, number[]>();

    for (const record of latencyHistory) {
      if (!byExchange.has(record.exchange)) {
        byExchange.set(record.exchange, []);
      }
      byExchange.get(record.exchange)!.push(record.latencyMs);
    }

    // 计算统计
    const result: LatencyStats[] = [];

    for (const [exchange, latencies] of byExchange) {
      // 排序
      const sorted = [...latencies].sort((a, b) => a - b);

      // 计算统计值
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Index = Math.floor(sorted.length * 0.95);
      const p99Index = Math.floor(sorted.length * 0.99);

      result.push({
        exchange,
        avgLatency: avg,
        p95Latency: sorted[p95Index] || avg,
        p99Latency: sorted[p99Index] || avg,
      });
    }

    return result;
  }

  /**
   * 生成每日报告
   */
  async generateDailyReport(): Promise<PerformanceReport> {
    // 获取保证金率
    const marginRatios = await this.getMarginRatios();

    // 获取延迟统计
    const latencyStats = await this.getLatencyStats();

    // 计算 API 统计
    const apiStats: ApiStats = {
      totalRequests: 0,
      errorCount: 0,
      errorRate: 0,
      avgLatency: 0,
      p99Latency: 0,
    };

    // 汇总延迟统计
    if (latencyStats.length > 0) {
      apiStats.avgLatency = latencyStats.reduce((sum, s) => sum + s.avgLatency, 0) / latencyStats.length;
      apiStats.p99Latency = Math.max(...latencyStats.map((s) => s.p99Latency));
    }

    // 生成报告
    const report = this.reportGenerator.generateDailyReport(
      this.currentEquity,
      marginRatios,
      apiStats
    );

    // 发出事件
    this.emit('dailyReportGenerated', report);

    return report;
  }

  /**
   * 暂停策略
   * @param reason - 原因
   */
  async pauseStrategies(reason: string): Promise<void> {
    if (this.pauseCallback) {
      this.pauseCallback(reason);
    }
  }

  /**
   * 恢复策略
   */
  async resumeStrategies(): Promise<void> {
    if (this.resumeCallback) {
      this.resumeCallback();
    }
  }

  // ========================================================================
  // 私有方法 - 事件处理
  // ========================================================================

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    // 监听 Prometheus 保证金预警
    this.prometheus.on('marginAlert', (exchange: string, ratio: number, threshold: number) => {
      // 发送 Telegram 告警
      if (this.config.enableTelegram) {
        this.telegram.sendMarginAlert(exchange, ratio, threshold);
      }

      // 发出事件
      this.emit(
        'alertTriggered',
        'margin',
        `${exchange} 保证金率 ${(ratio * 100).toFixed(2)}% 低于 ${(threshold * 100).toFixed(0)}%`
      );
    });

    // 监听延迟预警
    this.prometheus.on('latencyAlert', (exchange: string, operation: string, latencyMs: number) => {
      // 发送 Telegram 告警
      if (this.config.enableTelegram) {
        this.telegram.sendLatencyAlert(exchange, operation, latencyMs);
      }

      // 发出事件
      this.emit(
        'alertTriggered',
        'latency',
        `${exchange} ${operation} 延迟 ${latencyMs}ms`
      );
    });

    // 监听错误率预警
    this.prometheus.on('errorRateAlert', (exchange: string, errorRate: number) => {
      // 发送 Telegram 告警
      if (this.config.enableTelegram) {
        this.telegram.sendErrorRateAlert(exchange, errorRate);
      }

      // 发出事件
      this.emit(
        'alertTriggered',
        'error_rate',
        `${exchange} 错误率 ${(errorRate * 100).toFixed(2)}%`
      );
    });
  }

  // ========================================================================
  // 私有方法 - 定时器
  // ========================================================================

  /**
   * 启动指标采集定时器
   */
  private startMetricsTimer(): void {
    // 如果已存在，先停止
    this.stopMetricsTimer();

    // 创建定时器
    this.metricsTimer = setInterval(() => {
      // 采集系统指标
      this.prometheus.collectSystemMetrics();

      // 发出事件
      this.emit('metricsUpdated');
    }, this.config.metricsInterval);
  }

  /**
   * 停止指标采集定时器
   */
  private stopMetricsTimer(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
  }

  // ========================================================================
  // 私有方法 - HTTP 服务
  // ========================================================================

  /**
   * 启动 HTTP 服务（用于 Prometheus 抓取）
   */
  private async startHttpServer(): Promise<void> {
    // 注意：这里使用动态导入以避免直接依赖 http 模块
    // 实际使用时可以替换为 Express 等框架
    try {
      const http = await import('http');

      // 创建服务器
      const server = http.createServer((req, res) => {
        // 处理 /metrics 端点
        if (req.url === '/metrics') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(this.getPrometheusMetrics());
          return;
        }

        // 处理 /health 端点
        if (req.url === '/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', running: this.running }));
          return;
        }

        // 处理 /dashboards 端点
        if (req.url === '/dashboards') {
          res.setHeader('Content-Type', 'application/json');
          const dashboards = this.generateGrafanaDashboards();
          const result: Record<string, GrafanaDashboard> = {};
          for (const [name, dashboard] of dashboards) {
            result[name] = dashboard;
          }
          res.end(JSON.stringify(result, null, 2));
          return;
        }

        // 404
        res.statusCode = 404;
        res.end('Not Found');
      });

      // 启动服务器
      server.listen(this.config.httpPort, () => {
        console.log(`监控 HTTP 服务已启动: http://localhost:${this.config.httpPort}`);
        console.log(`  - Prometheus 指标: http://localhost:${this.config.httpPort}/metrics`);
        console.log(`  - 健康检查: http://localhost:${this.config.httpPort}/health`);
        console.log(`  - Grafana 仪表盘: http://localhost:${this.config.httpPort}/dashboards`);
      });

      // 保存引用
      this.httpServer = server;
    } catch (error) {
      console.error('HTTP 服务启动失败:', error);
    }
  }

  /**
   * 停止 HTTP 服务
   */
  private async stopHttpServer(): Promise<void> {
    if (this.httpServer) {
      // 关闭服务器
      await new Promise<void>((resolve) => {
        (this.httpServer as { close: (cb: () => void) => void }).close(() => {
          resolve();
        });
      });

      this.httpServer = null;
    }
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建监控协调器
 * @param config - 配置
 */
export function createMonitorOrchestrator(
  config?: Partial<MonitorOrchestratorConfig>
): MonitorOrchestrator {
  return new MonitorOrchestrator(config);
}

// 导出默认配置
export { DEFAULT_ORCHESTRATOR_CONFIG };
