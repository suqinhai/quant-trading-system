// ============================================================================
// 监控中心
// 整合告警、指标、健康检查的核心管理器
// ============================================================================

import EventEmitter from 'eventemitter3';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';

import { HealthCheckManager } from './health.js';
import { MetricsCollector } from './metrics.js';
import { NotificationSender } from './notifier.js';
import type {
  Alert,
  AlertLevel,
  AlertStatus,
  AlertType,
  IHealthChecker,
  MonitorConfig,
  MonitorEvents,
  NotificationChannel,
  SystemHealth,
} from './types.js';

// ============================================================================
// 监控中心
// ============================================================================

/**
 * 监控中心
 *
 * 功能：
 * - 统一管理告警、指标、健康检查
 * - 告警去重和静默
 * - 定期健康检查和指标采集
 * - 多渠道通知
 */
export class MonitorCenter extends EventEmitter<MonitorEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: MonitorConfig;

  // 告警历史
  private readonly alerts: Map<string, Alert> = new Map();

  // 告警去重映射（用于判断重复告警）
  private readonly alertFingerprints: Map<string, number> = new Map();

  // 健康检查管理器
  private readonly healthManager: HealthCheckManager;

  // 指标收集器
  private readonly metricsCollector: MetricsCollector;

  // 通知发送器
  private readonly notificationSender: NotificationSender;

  // 定时器
  private healthCheckTimer?: ReturnType<typeof setInterval>;
  private metricsTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  // 是否正在运行
  private running: boolean = false;

  /**
   * 构造函数
   */
  public constructor(config: Partial<MonitorConfig> = {}) {
    super();

    // 合并默认配置
    this.config = {
      healthCheckInterval: 30000, // 30 秒
      metricsInterval: 10000, // 10 秒
      metricsRetention: 3600000, // 1 小时
      alertDedupeWindow: 300000, // 5 分钟
      maxAlertHistory: 1000,
      channels: [],
      enableSystemMetrics: true,
      enableTradingMetrics: true,
      ...config,
    };

    // 初始化日志
    this.logger = pino({
      name: 'MonitorCenter',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化组件
    this.healthManager = new HealthCheckManager();
    this.metricsCollector = new MetricsCollector(this.config.metricsRetention);
    this.notificationSender = new NotificationSender(this.config.channels);

    this.logger.info({ config: this.config }, 'MonitorCenter initialized');
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  /**
   * 启动监控
   */
  public start(): void {
    if (this.running) {
      this.logger.warn('MonitorCenter already running');
      return;
    }

    this.running = true;

    // 启动健康检查定时器
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch(error => {
        this.logger.error({ error }, 'Health check failed');
      });
    }, this.config.healthCheckInterval);

    // 启动指标采集定时器
    if (this.config.enableSystemMetrics) {
      this.metricsTimer = setInterval(() => {
        this.metricsCollector.collectSystemMetrics();
      }, this.config.metricsInterval);
    }

    // 启动清理定时器（每 10 分钟清理一次）
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 600000);

    // 立即执行一次健康检查
    this.runHealthCheck().catch(error => {
      this.logger.error({ error }, 'Initial health check failed');
    });

    this.logger.info('MonitorCenter started');
  }

  /**
   * 停止监控
   */
  public stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    // 清理定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = undefined;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.logger.info('MonitorCenter stopped');
  }

  // ==========================================================================
  // 告警管理
  // ==========================================================================

  /**
   * 创建告警
   */
  public async alert(
    type: AlertType,
    level: AlertLevel,
    title: string,
    message: string,
    source: string,
    data?: Record<string, unknown>
  ): Promise<Alert> {
    // 生成告警指纹（用于去重）
    const fingerprint = this.generateFingerprint(type, level, title, source);

    // 检查是否在去重窗口内
    const lastAlertTime = this.alertFingerprints.get(fingerprint);
    if (lastAlertTime && Date.now() - lastAlertTime < this.config.alertDedupeWindow) {
      this.logger.debug({ fingerprint }, 'Alert deduplicated');
      // 返回已存在的告警
      const existingAlert = Array.from(this.alerts.values()).find(
        a => this.generateFingerprint(a.type, a.level, a.title, a.source) === fingerprint
      );
      if (existingAlert) {
        return existingAlert;
      }
    }

    // 创建新告警
    const alert: Alert = {
      id: uuidv4(),
      type,
      level,
      title,
      message,
      data,
      source,
      createdAt: Date.now(),
      status: 'active',
    };

    // 存储告警
    this.alerts.set(alert.id, alert);
    this.alertFingerprints.set(fingerprint, Date.now());

    // 发出事件
    this.emit('alertCreated', alert);

    this.logger.info(
      { alertId: alert.id, type, level, title, source },
      'Alert created'
    );

    // 发送通知
    try {
      const results = await this.notificationSender.send(alert);
      for (const [channel, success] of results) {
        if (success) {
          this.emit('notificationSent', channel, alert);
        } else {
          this.emit('notificationFailed', channel, alert, new Error('Send failed'));
        }
      }
    } catch (error) {
      this.logger.error({ error, alertId: alert.id }, 'Failed to send notifications');
    }

    return alert;
  }

  /**
   * 生成告警指纹
   */
  private generateFingerprint(
    type: AlertType,
    level: AlertLevel,
    title: string,
    source: string
  ): string {
    return `${type}:${level}:${title}:${source}`;
  }

  /**
   * 确认告警
   */
  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return false;
    }

    alert.status = 'acknowledged';
    alert.acknowledgedAt = Date.now();

    this.emit('alertUpdated', alert);
    this.logger.info({ alertId }, 'Alert acknowledged');

    return true;
  }

  /**
   * 解决告警
   */
  public resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status === 'resolved') {
      return false;
    }

    alert.status = 'resolved';
    alert.resolvedAt = Date.now();

    this.emit('alertResolved', alert);
    this.logger.info({ alertId }, 'Alert resolved');

    return true;
  }

  /**
   * 静默告警
   */
  public silenceAlert(alertId: string, duration: number): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return false;
    }

    alert.status = 'silenced';
    alert.silencedUntil = Date.now() + duration;

    this.emit('alertUpdated', alert);
    this.logger.info({ alertId, duration }, 'Alert silenced');

    return true;
  }

  /**
   * 获取告警
   */
  public getAlert(alertId: string): Alert | undefined {
    return this.alerts.get(alertId);
  }

  /**
   * 获取活跃告警列表
   */
  public getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter(
      a => a.status === 'active' || a.status === 'acknowledged'
    );
  }

  /**
   * 获取所有告警
   */
  public getAllAlerts(): Alert[] {
    return Array.from(this.alerts.values());
  }

  // ==========================================================================
  // 健康检查
  // ==========================================================================

  /**
   * 运行健康检查
   */
  private async runHealthCheck(): Promise<void> {
    const previousHealth = this.healthManager.getHealth();
    const currentHealth = await this.healthManager.checkAll();

    // 检查状态是否变化
    if (previousHealth.status !== currentHealth.status) {
      this.emit('healthChanged', currentHealth);

      // 如果状态变差，创建告警
      if (
        currentHealth.status === 'unhealthy' ||
        (currentHealth.status === 'degraded' && previousHealth.status === 'healthy')
      ) {
        const unhealthyComponents = currentHealth.components
          .filter(c => c.status !== 'healthy')
          .map(c => c.name);

        await this.alert(
          'system',
          currentHealth.status === 'unhealthy' ? 'critical' : 'warning',
          'System Health Degraded',
          `System health changed to ${currentHealth.status}. Affected components: ${unhealthyComponents.join(', ')}`,
          'health_check',
          { components: currentHealth.components }
        );
      }
    }
  }

  /**
   * 注册健康检查器
   */
  public registerHealthChecker(checker: IHealthChecker): void {
    this.healthManager.register(checker);
  }

  /**
   * 获取系统健康状态
   */
  public getHealth(): SystemHealth {
    return this.healthManager.getHealth();
  }

  /**
   * 手动触发健康检查
   */
  public async checkHealth(): Promise<SystemHealth> {
    return this.healthManager.checkAll();
  }

  // ==========================================================================
  // 指标管理
  // ==========================================================================

  /**
   * 获取指标收集器
   */
  public getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * 获取交易统计
   */
  public getTradingStats() {
    return this.metricsCollector.getTradingStats();
  }

  // ==========================================================================
  // 便捷告警方法
  // ==========================================================================

  /**
   * 创建信息告警
   */
  public async info(
    title: string,
    message: string,
    source: string,
    data?: Record<string, unknown>
  ): Promise<Alert> {
    return this.alert('custom', 'info', title, message, source, data);
  }

  /**
   * 创建警告告警
   */
  public async warning(
    title: string,
    message: string,
    source: string,
    data?: Record<string, unknown>
  ): Promise<Alert> {
    return this.alert('custom', 'warning', title, message, source, data);
  }

  /**
   * 创建严重告警
   */
  public async critical(
    title: string,
    message: string,
    source: string,
    data?: Record<string, unknown>
  ): Promise<Alert> {
    return this.alert('custom', 'critical', title, message, source, data);
  }

  /**
   * 创建紧急告警
   */
  public async emergency(
    title: string,
    message: string,
    source: string,
    data?: Record<string, unknown>
  ): Promise<Alert> {
    return this.alert('custom', 'emergency', title, message, source, data);
  }

  // ==========================================================================
  // 清理
  // ==========================================================================

  /**
   * 清理过期数据
   */
  private cleanup(): void {
    // 清理告警历史
    if (this.alerts.size > this.config.maxAlertHistory) {
      // 按时间排序，保留最新的
      const sortedAlerts = Array.from(this.alerts.entries())
        .sort((a, b) => b[1].createdAt - a[1].createdAt);

      // 删除旧的已解决告警
      const toDelete = sortedAlerts
        .filter(([, alert]) => alert.status === 'resolved')
        .slice(this.config.maxAlertHistory / 2);

      for (const [id] of toDelete) {
        this.alerts.delete(id);
      }
    }

    // 清理告警指纹缓存
    const fingerprintCutoff = Date.now() - this.config.alertDedupeWindow * 2;
    for (const [fingerprint, time] of this.alertFingerprints) {
      if (time < fingerprintCutoff) {
        this.alertFingerprints.delete(fingerprint);
      }
    }

    // 清理静默过期的告警
    for (const alert of this.alerts.values()) {
      if (alert.status === 'silenced' && alert.silencedUntil && Date.now() > alert.silencedUntil) {
        alert.status = 'active';
        this.emit('alertUpdated', alert);
      }
    }

    // 清理指标历史
    this.metricsCollector.cleanup();

    this.logger.debug('Cleanup completed');
  }
}
