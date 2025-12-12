// ============================================================================
// 健康检查管理器
// 管理各组件的健康检查
// ============================================================================

import pino from 'pino';

import type {
  ComponentHealth,
  HealthStatus,
  IHealthChecker,
  SystemHealth,
} from './types.js';

// ============================================================================
// 内置健康检查器
// ============================================================================

/**
 * 内存健康检查器
 */
export class MemoryHealthChecker implements IHealthChecker {
  public readonly name = 'memory';

  // 警告阈值（MB）
  private readonly warningThreshold: number;

  // 严重阈值（MB）
  private readonly criticalThreshold: number;

  public constructor(warningThreshold: number = 500, criticalThreshold: number = 800) {
    this.warningThreshold = warningThreshold;
    this.criticalThreshold = criticalThreshold;
  }

  public async check(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

    let status: HealthStatus = 'healthy';
    if (heapUsedMB >= this.criticalThreshold) {
      status = 'unhealthy';
    } else if (heapUsedMB >= this.warningThreshold) {
      status = 'degraded';
    }

    return {
      name: this.name,
      status,
      lastCheck: Date.now(),
      responseTime: Date.now() - startTime,
      details: {
        heapUsed: Math.round(heapUsedMB),
        heapTotal: Math.round(heapTotalMB),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
    };
  }
}

/**
 * 事件循环健康检查器
 */
export class EventLoopHealthChecker implements IHealthChecker {
  public readonly name = 'event_loop';

  // 延迟阈值（毫秒）
  private readonly warningThreshold: number;
  private readonly criticalThreshold: number;

  public constructor(warningThreshold: number = 100, criticalThreshold: number = 500) {
    this.warningThreshold = warningThreshold;
    this.criticalThreshold = criticalThreshold;
  }

  public async check(): Promise<ComponentHealth> {
    const startTime = Date.now();

    // 测量事件循环延迟
    const delay = await this.measureDelay();

    let status: HealthStatus = 'healthy';
    if (delay >= this.criticalThreshold) {
      status = 'unhealthy';
    } else if (delay >= this.warningThreshold) {
      status = 'degraded';
    }

    return {
      name: this.name,
      status,
      lastCheck: Date.now(),
      responseTime: Date.now() - startTime,
      details: {
        delay: Math.round(delay),
        warningThreshold: this.warningThreshold,
        criticalThreshold: this.criticalThreshold,
      },
    };
  }

  /**
   * 测量事件循环延迟
   */
  private measureDelay(): Promise<number> {
    return new Promise(resolve => {
      const start = Date.now();
      setImmediate(() => {
        resolve(Date.now() - start);
      });
    });
  }
}

/**
 * 自定义健康检查器（用于外部服务）
 */
export class CustomHealthChecker implements IHealthChecker {
  public readonly name: string;

  // 检查函数
  private readonly checkFn: () => Promise<{ healthy: boolean; details?: Record<string, unknown> }>;

  // 超时时间
  private readonly timeout: number;

  public constructor(
    name: string,
    checkFn: () => Promise<{ healthy: boolean; details?: Record<string, unknown> }>,
    timeout: number = 5000
  ) {
    this.name = name;
    this.checkFn = checkFn;
    this.timeout = timeout;
  }

  public async check(): Promise<ComponentHealth> {
    const startTime = Date.now();

    try {
      // 带超时的检查
      const result = await Promise.race([
        this.checkFn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), this.timeout)
        ),
      ]);

      return {
        name: this.name,
        status: result.healthy ? 'healthy' : 'unhealthy',
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        details: result.details,
      };
    } catch (error) {
      return {
        name: this.name,
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// ============================================================================
// 健康检查管理器
// ============================================================================

/**
 * 健康检查管理器
 *
 * 功能：
 * - 注册和管理健康检查器
 * - 定期执行健康检查
 * - 汇总系统健康状态
 * - 健康状态变化通知
 */
export class HealthCheckManager {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 健康检查器列表
  private readonly checkers: IHealthChecker[] = [];

  // 最新健康状态
  private latestHealth: SystemHealth;

  // 系统启动时间
  private readonly startTime: number;

  /**
   * 构造函数
   */
  public constructor() {
    this.startTime = Date.now();

    // 初始化日志
    this.logger = pino({
      name: 'HealthCheckManager',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化健康状态
    this.latestHealth = {
      status: 'unknown',
      components: [],
      timestamp: Date.now(),
      uptime: 0,
    };

    // 注册内置检查器
    this.registerBuiltInCheckers();

    this.logger.info('HealthCheckManager initialized');
  }

  /**
   * 注册内置检查器
   */
  private registerBuiltInCheckers(): void {
    this.register(new MemoryHealthChecker());
    this.register(new EventLoopHealthChecker());
  }

  // ==========================================================================
  // 检查器管理
  // ==========================================================================

  /**
   * 注册健康检查器
   */
  public register(checker: IHealthChecker): void {
    this.checkers.push(checker);
    this.logger.debug({ name: checker.name }, 'Health checker registered');
  }

  /**
   * 移除健康检查器
   */
  public unregister(name: string): boolean {
    const index = this.checkers.findIndex(c => c.name === name);
    if (index >= 0) {
      this.checkers.splice(index, 1);
      this.logger.debug({ name }, 'Health checker unregistered');
      return true;
    }
    return false;
  }

  // ==========================================================================
  // 健康检查
  // ==========================================================================

  /**
   * 执行所有健康检查
   */
  public async checkAll(): Promise<SystemHealth> {
    const components: ComponentHealth[] = [];

    // 并行执行所有检查
    const results = await Promise.allSettled(
      this.checkers.map(checker => checker.check())
    );

    // 收集结果
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const checker = this.checkers[i];

      if (!checker) continue;

      if (result && result.status === 'fulfilled') {
        components.push(result.value);
      } else if (result && result.status === 'rejected') {
        components.push({
          name: checker.name,
          status: 'unhealthy',
          lastCheck: Date.now(),
          error: result.reason instanceof Error ? result.reason.message : 'Check failed',
        });
      }
    }

    // 计算整体状态
    const overallStatus = this.calculateOverallStatus(components);

    // 更新最新状态
    this.latestHealth = {
      status: overallStatus,
      components,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
    };

    return this.latestHealth;
  }

  /**
   * 计算整体健康状态
   */
  private calculateOverallStatus(components: ComponentHealth[]): HealthStatus {
    if (components.length === 0) {
      return 'unknown';
    }

    // 检查是否有不健康的组件
    const hasUnhealthy = components.some(c => c.status === 'unhealthy');
    if (hasUnhealthy) {
      return 'unhealthy';
    }

    // 检查是否有降级的组件
    const hasDegraded = components.some(c => c.status === 'degraded');
    if (hasDegraded) {
      return 'degraded';
    }

    // 检查是否有未知状态的组件
    const hasUnknown = components.some(c => c.status === 'unknown');
    if (hasUnknown) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * 获取最新健康状态
   */
  public getHealth(): SystemHealth {
    return this.latestHealth;
  }

  /**
   * 检查单个组件
   */
  public async checkComponent(name: string): Promise<ComponentHealth | undefined> {
    const checker = this.checkers.find(c => c.name === name);
    if (!checker) {
      return undefined;
    }

    try {
      return await checker.check();
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Check failed',
      };
    }
  }

  /**
   * 获取系统运行时间
   */
  public getUptime(): number {
    return Date.now() - this.startTime;
  }
}
