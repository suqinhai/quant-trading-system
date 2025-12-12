// ============================================================================
// @quant/monitor 包入口文件
// 导出所有公共 API
// ============================================================================

// === 类型导出 ===
export type {
  // 告警类型
  AlertLevel,
  AlertType,
  AlertStatus,
  Alert,

  // 指标类型
  MetricType,
  MetricPoint,
  MetricDefinition,
  Metric,

  // 健康检查类型
  HealthStatus,
  ComponentHealth,
  SystemHealth,

  // 通知渠道类型
  NotificationChannel,
  EmailConfig,
  WebhookConfig,
  TelegramConfig,
  DingtalkConfig,
  NotificationChannelConfig,

  // 配置类型
  MonitorConfig,

  // 交易统计
  TradingStats,

  // 事件类型
  MonitorEvents,

  // 接口
  IHealthChecker,
} from './types.js';

// === 健康检查导出 ===
export {
  MemoryHealthChecker,
  EventLoopHealthChecker,
  CustomHealthChecker,
  HealthCheckManager,
} from './health.js';

// === 指标收集器导出 ===
export { MetricsCollector } from './metrics.js';

// === 通知发送器导出 ===
export { NotificationSender } from './notifier.js';

// === 监控中心导出 ===
export { MonitorCenter } from './monitor.js';

// ============================================================================
// Prometheus 指标收集器
// ============================================================================
export {
  // 类
  PrometheusCollector,
  // 工厂函数
  createPrometheusCollector,
  // 默认配置
  DEFAULT_PROMETHEUS_CONFIG,
} from './prometheus.js';

// Prometheus 类型导出
export type {
  // 指标类型
  PrometheusMetricType,
  MetricLabels,
  HistogramBuckets,
  PrometheusMetricConfig,
  // 记录类型
  PnlRecord,
  MarginRecord,
  LatencyRecord,
  ApiErrorRecord,
  // 配置类型
  PrometheusConfig,
  // 事件类型
  PrometheusEvents,
} from './prometheus.js';

// ============================================================================
// Telegram 机器人通知服务
// ============================================================================
export {
  // 类
  TelegramBot,
  // 工厂函数
  createTelegramBot,
  // 默认配置
  DEFAULT_TELEGRAM_CONFIG,
} from './telegram-bot.js';

// Telegram 类型导出
export type {
  // 解析模式
  ParseMode,
  // 消息优先级
  MessagePriority,
  // 告警类型
  AlertType as TelegramAlertType,
  // 配置类型
  TelegramBotConfig,
  // 消息类型
  AlertMessage,
  // 报告类型
  PerformanceReport,
  StrategyPerformance,
  ExchangeMarginRatio,
  ApiStats,
  // 数据提供器接口
  DataProvider,
} from './telegram-bot.js';

// ============================================================================
// 每日报告生成器
// ============================================================================
export {
  // 类
  DailyReportGenerator,
  // 工厂函数
  createDailyReportGenerator,
  // 默认配置
  DEFAULT_REPORT_CONFIG,
  DEFAULT_CHART_CONFIG,
} from './daily-report.js';

// 每日报告类型导出
export type {
  // 数据点类型
  TimeSeriesPoint,
  TimeSeriesData,
  BarChartData,
  PieChartData,
  // 图表配置
  ChartConfig,
  // 报告配置
  ReportGeneratorConfig,
  // 历史数据
  HistoricalData,
  // 交易记录
  TradeRecord,
} from './daily-report.js';

// ============================================================================
// Grafana 仪表盘生成器
// ============================================================================
export {
  // 类
  GrafanaDashboardGenerator,
  // 工厂函数
  createGrafanaDashboardGenerator,
  // 默认配置
  DEFAULT_GENERATOR_CONFIG,
} from './grafana-dashboards.js';

// Grafana 类型导出
export type {
  // 面板类型
  GrafanaPanelType,
  GrafanaDataSource,
  ColorMode,
  // 配置类型
  ThresholdConfig,
  PanelTarget,
  FieldConfig,
  GrafanaPanel,
  DashboardRow,
  GrafanaDashboard,
  DashboardGeneratorConfig,
} from './grafana-dashboards.js';

// ============================================================================
// 监控协调器
// ============================================================================
export {
  // 类
  MonitorOrchestrator,
  // 工厂函数
  createMonitorOrchestrator,
  // 默认配置
  DEFAULT_ORCHESTRATOR_CONFIG,
} from './monitor-orchestrator.js';

// 监控协调器类型导出
export type {
  // 配置类型
  MonitorOrchestratorConfig,
  // 数据类型
  PositionData,
  LatencyStats,
  // 事件类型
  MonitorEvents as OrchestratorEvents,
} from './monitor-orchestrator.js';
