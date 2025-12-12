// ============================================================================
// 监控告警类型定义
// ============================================================================

import type Decimal from 'decimal.js';

// ============================================================================
// 告警类型
// ============================================================================

/**
 * 告警级别
 * - info: 信息通知
 * - warning: 警告，需要关注
 * - critical: 严重，需要立即处理
 * - emergency: 紧急，系统可能停止工作
 */
export type AlertLevel = 'info' | 'warning' | 'critical' | 'emergency';

/**
 * 告警类型
 */
export type AlertType =
  | 'system' // 系统告警（CPU、内存、磁盘等）
  | 'trading' // 交易告警（订单失败、滑点过大等）
  | 'risk' // 风控告警（触发风控规则）
  | 'connection' // 连接告警（交易所断连、API错误等）
  | 'strategy' // 策略告警（策略异常、信号异常等）
  | 'pnl' // 盈亏告警（亏损预警、收益异常等）
  | 'custom'; // 自定义告警

/**
 * 告警状态
 */
export type AlertStatus =
  | 'active' // 活跃中
  | 'acknowledged' // 已确认
  | 'resolved' // 已解决
  | 'silenced'; // 已静默

/**
 * 告警信息
 */
export interface Alert {
  // 唯一标识
  readonly id: string;

  // 告警类型
  readonly type: AlertType;

  // 告警级别
  readonly level: AlertLevel;

  // 告警标题
  readonly title: string;

  // 告警详情
  readonly message: string;

  // 相关数据
  readonly data?: Record<string, unknown>;

  // 来源（策略名、模块名等）
  readonly source: string;

  // 创建时间
  readonly createdAt: number;

  // 状态
  status: AlertStatus;

  // 确认时间
  acknowledgedAt?: number;

  // 解决时间
  resolvedAt?: number;

  // 静默到期时间
  silencedUntil?: number;
}

// ============================================================================
// 指标类型
// ============================================================================

/**
 * 指标类型
 */
export type MetricType =
  | 'counter' // 计数器（只增不减）
  | 'gauge' // 仪表盘（可增可减）
  | 'histogram'; // 直方图（分布统计）

/**
 * 指标数据点
 */
export interface MetricPoint {
  // 时间戳
  readonly timestamp: number;

  // 指标值
  readonly value: number;

  // 标签
  readonly labels?: Record<string, string>;
}

/**
 * 指标定义
 */
export interface MetricDefinition {
  // 指标名称
  readonly name: string;

  // 指标类型
  readonly type: MetricType;

  // 描述
  readonly description: string;

  // 单位
  readonly unit?: string;

  // 标签键
  readonly labelKeys?: string[];
}

/**
 * 指标数据
 */
export interface Metric extends MetricDefinition {
  // 当前值
  value: number;

  // 最后更新时间
  lastUpdated: number;

  // 历史数据点
  history: MetricPoint[];
}

// ============================================================================
// 健康检查类型
// ============================================================================

/**
 * 健康状态
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * 组件健康信息
 */
export interface ComponentHealth {
  // 组件名称
  readonly name: string;

  // 健康状态
  status: HealthStatus;

  // 最后检查时间
  lastCheck: number;

  // 响应时间（毫秒）
  responseTime?: number;

  // 详细信息
  details?: Record<string, unknown>;

  // 错误信息
  error?: string;
}

/**
 * 系统健康信息
 */
export interface SystemHealth {
  // 整体状态
  status: HealthStatus;

  // 各组件状态
  components: ComponentHealth[];

  // 检查时间
  timestamp: number;

  // 系统运行时间
  uptime: number;
}

// ============================================================================
// 通知渠道类型
// ============================================================================

/**
 * 通知渠道类型
 */
export type NotificationChannel =
  | 'email' // 邮件
  | 'webhook' // Webhook
  | 'telegram' // Telegram
  | 'dingtalk' // 钉钉
  | 'console'; // 控制台

/**
 * 邮件配置
 */
export interface EmailConfig {
  // SMTP 服务器
  readonly host: string;

  // SMTP 端口
  readonly port: number;

  // 是否使用 SSL
  readonly secure: boolean;

  // 用户名
  readonly user: string;

  // 密码
  readonly pass: string;

  // 发件人地址
  readonly from: string;

  // 收件人列表
  readonly to: string[];
}

/**
 * Webhook 配置
 */
export interface WebhookConfig {
  // Webhook URL
  readonly url: string;

  // HTTP 方法
  readonly method?: 'POST' | 'PUT';

  // 自定义请求头
  readonly headers?: Record<string, string>;

  // 超时时间（毫秒）
  readonly timeout?: number;
}

/**
 * Telegram 配置
 */
export interface TelegramConfig {
  // Bot Token
  readonly botToken: string;

  // Chat ID
  readonly chatId: string;

  // 是否解析 Markdown
  readonly parseMode?: 'Markdown' | 'HTML';
}

/**
 * 钉钉配置
 */
export interface DingtalkConfig {
  // Webhook URL
  readonly webhook: string;

  // 签名密钥（可选）
  readonly secret?: string;

  // @提醒的手机号列表
  readonly atMobiles?: string[];

  // 是否@所有人
  readonly atAll?: boolean;
}

/**
 * 通知渠道配置
 */
export interface NotificationChannelConfig {
  // 渠道类型
  readonly type: NotificationChannel;

  // 是否启用
  enabled: boolean;

  // 最小告警级别（低于此级别不发送）
  readonly minLevel: AlertLevel;

  // 渠道特定配置
  readonly config: EmailConfig | WebhookConfig | TelegramConfig | DingtalkConfig | Record<string, never>;
}

// ============================================================================
// 监控配置
// ============================================================================

/**
 * 监控配置
 */
export interface MonitorConfig {
  // 健康检查间隔（毫秒）
  readonly healthCheckInterval: number;

  // 指标采集间隔（毫秒）
  readonly metricsInterval: number;

  // 指标历史保留时间（毫秒）
  readonly metricsRetention: number;

  // 告警去重时间窗口（毫秒）
  readonly alertDedupeWindow: number;

  // 告警历史保留数量
  readonly maxAlertHistory: number;

  // 通知渠道配置
  readonly channels: NotificationChannelConfig[];

  // 是否启用系统指标采集
  readonly enableSystemMetrics: boolean;

  // 是否启用交易指标采集
  readonly enableTradingMetrics: boolean;
}

// ============================================================================
// 交易统计类型
// ============================================================================

/**
 * 实时交易统计
 */
export interface TradingStats {
  // === 订单统计 ===
  // 总订单数
  totalOrders: number;

  // 成功订单数
  successfulOrders: number;

  // 失败订单数
  failedOrders: number;

  // 取消订单数
  cancelledOrders: number;

  // === 成交统计 ===
  // 总成交量
  totalVolume: Decimal;

  // 总成交额
  totalValue: Decimal;

  // 总手续费
  totalFees: Decimal;

  // === 盈亏统计 ===
  // 已实现盈亏
  realizedPnL: Decimal;

  // 未实现盈亏
  unrealizedPnL: Decimal;

  // 总盈亏
  totalPnL: Decimal;

  // === 时间统计 ===
  // 统计开始时间
  startTime: number;

  // 最后更新时间
  lastUpdated: number;
}

// ============================================================================
// 监控事件
// ============================================================================

/**
 * 监控事件
 */
export interface MonitorEvents {
  // 新告警
  alertCreated: (alert: Alert) => void;

  // 告警状态更新
  alertUpdated: (alert: Alert) => void;

  // 告警已解决
  alertResolved: (alert: Alert) => void;

  // 健康状态变化
  healthChanged: (health: SystemHealth) => void;

  // 指标更新
  metricUpdated: (metric: Metric) => void;

  // 通知已发送
  notificationSent: (channel: NotificationChannel, alert: Alert) => void;

  // 通知发送失败
  notificationFailed: (channel: NotificationChannel, alert: Alert, error: Error) => void;

  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 健康检查器接口
// ============================================================================

/**
 * 健康检查器接口
 */
export interface IHealthChecker {
  // 组件名称
  readonly name: string;

  // 执行健康检查
  check(): Promise<ComponentHealth>;
}
