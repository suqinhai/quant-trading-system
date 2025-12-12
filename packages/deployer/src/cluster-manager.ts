// ============================================================================
// 集群管理器模块
// 处理 PM2 集群模式下的优雅关闭、零宕机重载和进程间通信
// ============================================================================

// 导入 Node.js 集群模块
import cluster from 'cluster';
// 导入事件发射器
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 集群管理器配置接口
 * 定义集群管理器的所有配置选项
 */
export interface ClusterManagerConfig {
  // 优雅关闭超时时间（毫秒）
  gracefulShutdownTimeout: number;
  // 就绪信号发送前的延迟（毫秒，用于确保服务完全启动）
  readyDelay: number;
  // 是否启用进程间通信
  enableIPC: boolean;
  // 健康检查间隔（毫秒）
  healthCheckInterval: number;
  // 最大内存使用量（MB，超过则触发软重启）
  maxMemoryMB: number;
  // 是否启用自动内存监控
  enableMemoryMonitor: boolean;
}

/**
 * 默认集群管理器配置
 */
const DEFAULT_CLUSTER_MANAGER_CONFIG: ClusterManagerConfig = {
  // 优雅关闭超时 15 秒
  gracefulShutdownTimeout: 15000,
  // 就绪延迟 1 秒
  readyDelay: 1000,
  // 启用进程间通信
  enableIPC: true,
  // 健康检查间隔 30 秒
  healthCheckInterval: 30000,
  // 最大内存 1.5GB
  maxMemoryMB: 1536,
  // 启用内存监控
  enableMemoryMonitor: true,
};

/**
 * 进程状态枚举
 */
export enum ProcessState {
  // 初始化中
  INITIALIZING = 'initializing',
  // 运行中
  RUNNING = 'running',
  // 正在关闭
  SHUTTING_DOWN = 'shutting_down',
  // 已关闭
  STOPPED = 'stopped',
}

/**
 * 进程间消息类型
 */
export enum IPCMessageType {
  // 就绪信号
  READY = 'ready',
  // 关闭信号
  SHUTDOWN = 'shutdown',
  // 健康检查
  HEALTH_CHECK = 'health_check',
  // 健康响应
  HEALTH_RESPONSE = 'health_response',
  // 广播消息
  BROADCAST = 'broadcast',
  // 策略更新通知
  STRATEGY_UPDATE = 'strategy_update',
  // 配置更新通知
  CONFIG_UPDATE = 'config_update',
  // 重载请求
  RELOAD_REQUEST = 'reload_request',
}

/**
 * 进程间消息接口
 */
export interface IPCMessage {
  // 消息类型
  type: IPCMessageType;
  // 消息来源（进程 ID）
  from: number;
  // 消息目标（进程 ID，-1 表示广播）
  to: number;
  // 消息数据
  data?: unknown;
  // 消息时间戳
  timestamp: number;
}

/**
 * 健康状态接口
 */
export interface HealthStatus {
  // 进程 ID
  pid: number;
  // 进程状态
  state: ProcessState;
  // 内存使用量（MB）
  memoryMB: number;
  // 运行时间（秒）
  uptime: number;
  // 处理的请求数
  requestCount: number;
  // 最后活跃时间
  lastActiveTime: number;
}

/**
 * 关闭钩子函数类型
 */
export type ShutdownHook = () => Promise<void>;

/**
 * 集群管理器事件接口
 */
export interface ClusterManagerEvents {
  // 进程就绪
  ready: () => void;
  // 关闭开始
  shutdownStart: () => void;
  // 关闭完成
  shutdownComplete: () => void;
  // 关闭超时
  shutdownTimeout: () => void;
  // 收到 IPC 消息
  message: (message: IPCMessage) => void;
  // 策略更新
  strategyUpdate: (strategyId: string) => void;
  // 配置更新
  configUpdate: (config: unknown) => void;
  // 内存警告
  memoryWarning: (usageMB: number, limitMB: number) => void;
  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 集群管理器类
// ============================================================================

/**
 * 集群管理器
 * 负责管理 PM2 集群模式下的进程生命周期
 */
export class ClusterManager extends EventEmitter<ClusterManagerEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置对象
  private config: ClusterManagerConfig;

  // 当前进程状态
  private state: ProcessState = ProcessState.INITIALIZING;

  // 关闭钩子列表
  private shutdownHooks: ShutdownHook[] = [];

  // 是否正在关闭
  private isShuttingDown: boolean = false;

  // 健康检查定时器
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  // 内存监控定时器
  private memoryMonitorTimer: ReturnType<typeof setInterval> | null = null;

  // 进程启动时间
  private startTime: number = Date.now();

  // 处理的请求计数
  private requestCount: number = 0;

  // 最后活跃时间
  private lastActiveTime: number = Date.now();

  // 关闭超时定时器
  private shutdownTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置选项
   */
  constructor(config?: Partial<ClusterManagerConfig>) {
    // 调用父类构造函数
    super();

    // 合并配置
    this.config = {
      ...DEFAULT_CLUSTER_MANAGER_CONFIG,
      ...config,
    };
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 初始化集群管理器
   * 设置信号处理器和进程间通信
   */
  async initialize(): Promise<void> {
    // 设置进程信号处理器
    this.setupSignalHandlers();

    // 设置 PM2 消息处理器
    this.setupPM2MessageHandler();

    // 启动健康检查（如果启用 IPC）
    if (this.config.enableIPC) {
      this.startHealthCheck();
    }

    // 启动内存监控（如果启用）
    if (this.config.enableMemoryMonitor) {
      this.startMemoryMonitor();
    }

    // 更新状态为初始化完成
    this.state = ProcessState.RUNNING;

    // 延迟发送就绪信号
    // 这是 PM2 wait_ready 功能所需的
    setTimeout(() => {
      // 发送 ready 信号给 PM2
      this.sendReadySignal();

      // 发出就绪事件
      this.emit('ready');
    }, this.config.readyDelay);
  }

  /**
   * 注册关闭钩子
   * 在进程关闭前执行的清理函数
   * @param hook - 关闭钩子函数
   */
  registerShutdownHook(hook: ShutdownHook): void {
    // 添加到钩子列表
    this.shutdownHooks.push(hook);
  }

  /**
   * 触发优雅关闭
   * @param reason - 关闭原因
   */
  async gracefulShutdown(reason: string = 'manual'): Promise<void> {
    // 如果已经在关闭中，直接返回
    if (this.isShuttingDown) {
      return;
    }

    // 标记正在关闭
    this.isShuttingDown = true;

    // 更新状态
    this.state = ProcessState.SHUTTING_DOWN;

    // 发出关闭开始事件
    this.emit('shutdownStart');

    // 记录关闭原因
    console.log(`[ClusterManager] 开始优雅关闭，原因: ${reason}`);

    // 设置关闭超时定时器
    this.shutdownTimeoutTimer = setTimeout(() => {
      // 发出超时事件
      this.emit('shutdownTimeout');

      // 记录超时警告
      console.warn('[ClusterManager] 优雅关闭超时，强制退出');

      // 强制退出
      process.exit(1);
    }, this.config.gracefulShutdownTimeout);

    try {
      // 停止接受新请求（这里需要应用层配合）
      // 通常通过关闭 HTTP 服务器的 keepAlive 连接来实现

      // 执行所有关闭钩子
      await this.executeShutdownHooks();

      // 清理定时器
      this.cleanup();

      // 清除超时定时器
      if (this.shutdownTimeoutTimer) {
        clearTimeout(this.shutdownTimeoutTimer);
        this.shutdownTimeoutTimer = null;
      }

      // 更新状态
      this.state = ProcessState.STOPPED;

      // 发出关闭完成事件
      this.emit('shutdownComplete');

      // 记录完成
      console.log('[ClusterManager] 优雅关闭完成');

      // 正常退出
      process.exit(0);
    } catch (error) {
      // 记录错误
      console.error('[ClusterManager] 关闭过程中发生错误:', error);

      // 发出错误事件
      this.emit('error', error as Error);

      // 异常退出
      process.exit(1);
    }
  }

  /**
   * 发送就绪信号给 PM2
   * PM2 的 wait_ready 功能需要接收此信号
   */
  sendReadySignal(): void {
    // 检查是否在 PM2 环境中运行
    if (process.send) {
      // 发送 ready 消息给 PM2
      process.send('ready');
      // 记录日志
      console.log('[ClusterManager] 已发送就绪信号给 PM2');
    }
  }

  // ========================================================================
  // 公共方法 - 进程间通信
  // ========================================================================

  /**
   * 发送 IPC 消息
   * @param type - 消息类型
   * @param data - 消息数据
   * @param targetPid - 目标进程 ID（-1 表示广播）
   */
  sendIPCMessage(type: IPCMessageType, data?: unknown, targetPid: number = -1): void {
    // 构建消息
    const message: IPCMessage = {
      type,
      from: process.pid,
      to: targetPid,
      data,
      timestamp: Date.now(),
    };

    // 检查是否在 PM2 环境中运行
    if (process.send) {
      // 发送消息给 PM2（PM2 会路由到其他进程）
      process.send({
        type: 'process:msg',
        data: message,
      });
    }
  }

  /**
   * 广播策略更新通知
   * @param strategyId - 策略 ID
   */
  broadcastStrategyUpdate(strategyId: string): void {
    // 发送广播消息
    this.sendIPCMessage(IPCMessageType.STRATEGY_UPDATE, { strategyId });

    // 记录日志
    console.log(`[ClusterManager] 广播策略更新: ${strategyId}`);
  }

  /**
   * 广播配置更新通知
   * @param config - 配置对象
   */
  broadcastConfigUpdate(config: unknown): void {
    // 发送广播消息
    this.sendIPCMessage(IPCMessageType.CONFIG_UPDATE, config);

    // 记录日志
    console.log('[ClusterManager] 广播配置更新');
  }

  /**
   * 请求重载
   * 向 PM2 发送重载请求
   */
  requestReload(): void {
    // 发送重载请求
    this.sendIPCMessage(IPCMessageType.RELOAD_REQUEST);

    // 记录日志
    console.log('[ClusterManager] 已发送重载请求');
  }

  // ========================================================================
  // 公共方法 - 状态查询
  // ========================================================================

  /**
   * 获取当前进程状态
   * @returns 进程状态
   */
  getState(): ProcessState {
    return this.state;
  }

  /**
   * 获取健康状态
   * @returns 健康状态对象
   */
  getHealthStatus(): HealthStatus {
    // 获取内存使用情况
    const memUsage = process.memoryUsage();

    // 返回健康状态
    return {
      // 进程 ID
      pid: process.pid,
      // 当前状态
      state: this.state,
      // 内存使用量（转换为 MB）
      memoryMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      // 运行时间（秒）
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      // 处理的请求数
      requestCount: this.requestCount,
      // 最后活跃时间
      lastActiveTime: this.lastActiveTime,
    };
  }

  /**
   * 检查进程是否健康
   * @returns 是否健康
   */
  isHealthy(): boolean {
    // 检查状态是否为运行中
    if (this.state !== ProcessState.RUNNING) {
      return false;
    }

    // 获取内存使用情况
    const memUsage = process.memoryUsage();
    const memoryMB = memUsage.heapUsed / 1024 / 1024;

    // 检查内存是否超限
    if (memoryMB > this.config.maxMemoryMB) {
      return false;
    }

    // 健康
    return true;
  }

  /**
   * 记录请求处理
   * 用于统计请求数和更新最后活跃时间
   */
  recordRequest(): void {
    // 增加请求计数
    this.requestCount++;

    // 更新最后活跃时间
    this.lastActiveTime = Date.now();
  }

  /**
   * 检查是否正在关闭
   * @returns 是否正在关闭
   */
  isShuttingDownNow(): boolean {
    return this.isShuttingDown;
  }

  /**
   * 获取进程 ID
   * @returns 当前进程 ID
   */
  getPid(): number {
    return process.pid;
  }

  /**
   * 获取 Worker ID
   * @returns Worker ID（如果是 Worker 进程）
   */
  getWorkerId(): number | undefined {
    // 检查是否是 Worker 进程
    if (cluster.isWorker && cluster.worker) {
      return cluster.worker.id;
    }
    return undefined;
  }

  // ========================================================================
  // 私有方法 - 信号处理
  // ========================================================================

  /**
   * 设置进程信号处理器
   * 处理 SIGTERM、SIGINT 等信号
   */
  private setupSignalHandlers(): void {
    // 处理 SIGTERM 信号（PM2 发送的优雅关闭信号）
    process.on('SIGTERM', () => {
      // 记录日志
      console.log('[ClusterManager] 收到 SIGTERM 信号');

      // 执行优雅关闭
      this.gracefulShutdown('SIGTERM');
    });

    // 处理 SIGINT 信号（Ctrl+C）
    process.on('SIGINT', () => {
      // 记录日志
      console.log('[ClusterManager] 收到 SIGINT 信号');

      // 执行优雅关闭
      this.gracefulShutdown('SIGINT');
    });

    // 处理未捕获的异常
    process.on('uncaughtException', (error) => {
      // 记录错误
      console.error('[ClusterManager] 未捕获的异常:', error);

      // 发出错误事件
      this.emit('error', error);

      // 执行优雅关闭
      this.gracefulShutdown('uncaughtException');
    });

    // 处理未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
      // 记录错误
      console.error('[ClusterManager] 未处理的 Promise 拒绝:', reason);

      // 创建错误对象
      const error = reason instanceof Error ? reason : new Error(String(reason));

      // 发出错误事件
      this.emit('error', error);

      // 不立即关闭，只记录警告
      // 某些情况下未处理的拒绝可能不影响系统运行
    });
  }

  /**
   * 设置 PM2 消息处理器
   * 处理来自 PM2 的进程间消息
   */
  private setupPM2MessageHandler(): void {
    // 监听进程消息
    process.on('message', (packet: { type?: string; data?: IPCMessage }) => {
      // 检查是否是 PM2 的进程间消息
      if (packet.type === 'process:msg' && packet.data) {
        // 获取消息
        const message = packet.data;

        // 检查消息是否发给自己或是广播
        if (message.to === -1 || message.to === process.pid) {
          // 处理消息
          this.handleIPCMessage(message);
        }
      }
    });
  }

  /**
   * 处理 IPC 消息
   * @param message - 消息对象
   */
  private handleIPCMessage(message: IPCMessage): void {
    // 发出消息事件
    this.emit('message', message);

    // 根据消息类型处理
    switch (message.type) {
      // 关闭信号
      case IPCMessageType.SHUTDOWN:
        // 执行优雅关闭
        this.gracefulShutdown('IPC_SHUTDOWN');
        break;

      // 健康检查请求
      case IPCMessageType.HEALTH_CHECK:
        // 发送健康响应
        this.sendIPCMessage(
          IPCMessageType.HEALTH_RESPONSE,
          this.getHealthStatus(),
          message.from
        );
        break;

      // 策略更新通知
      case IPCMessageType.STRATEGY_UPDATE:
        // 提取策略 ID
        const strategyData = message.data as { strategyId: string };
        if (strategyData && strategyData.strategyId) {
          // 发出策略更新事件
          this.emit('strategyUpdate', strategyData.strategyId);
        }
        break;

      // 配置更新通知
      case IPCMessageType.CONFIG_UPDATE:
        // 发出配置更新事件
        this.emit('configUpdate', message.data);
        break;

      // 其他消息类型忽略
      default:
        // 仅记录未知消息类型
        console.log(`[ClusterManager] 收到未知消息类型: ${message.type}`);
        break;
    }
  }

  // ========================================================================
  // 私有方法 - 健康检查和内存监控
  // ========================================================================

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck(): void {
    // 如果已存在定时器，先清除
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // 创建健康检查定时器
    this.healthCheckTimer = setInterval(() => {
      // 检查健康状态
      if (!this.isHealthy()) {
        // 记录警告
        console.warn('[ClusterManager] 健康检查失败');
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * 启动内存监控定时器
   */
  private startMemoryMonitor(): void {
    // 如果已存在定时器，先清除
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
    }

    // 监控间隔（30 秒）
    const monitorInterval = 30000;

    // 创建内存监控定时器
    this.memoryMonitorTimer = setInterval(() => {
      // 获取内存使用情况
      const memUsage = process.memoryUsage();
      const memoryMB = memUsage.heapUsed / 1024 / 1024;

      // 计算警告阈值（80% 的最大值）
      const warningThreshold = this.config.maxMemoryMB * 0.8;

      // 检查是否超过警告阈值
      if (memoryMB > warningThreshold) {
        // 发出内存警告事件
        this.emit('memoryWarning', memoryMB, this.config.maxMemoryMB);

        // 记录警告
        console.warn(
          `[ClusterManager] 内存使用过高: ${memoryMB.toFixed(0)}MB / ${this.config.maxMemoryMB}MB`
        );
      }

      // 检查是否超过最大值
      if (memoryMB > this.config.maxMemoryMB) {
        // 记录错误
        console.error('[ClusterManager] 内存超限，请求重载');

        // 尝试触发垃圾回收（如果可用）
        if (global.gc) {
          global.gc();
        }
      }
    }, monitorInterval);
  }

  // ========================================================================
  // 私有方法 - 关闭处理
  // ========================================================================

  /**
   * 执行所有关闭钩子
   */
  private async executeShutdownHooks(): Promise<void> {
    // 记录日志
    console.log(`[ClusterManager] 执行 ${this.shutdownHooks.length} 个关闭钩子`);

    // 按顺序执行所有钩子
    for (let i = 0; i < this.shutdownHooks.length; i++) {
      const hook = this.shutdownHooks[i];
      // 检查钩子是否存在
      if (hook) {
        try {
          // 记录进度
          console.log(`[ClusterManager] 执行关闭钩子 ${i + 1}/${this.shutdownHooks.length}`);

          // 执行钩子
          await hook();
        } catch (error) {
          // 记录错误但继续执行其他钩子
          console.error(`[ClusterManager] 关闭钩子 ${i + 1} 执行失败:`, error);
        }
      }
    }

    // 记录完成
    console.log('[ClusterManager] 所有关闭钩子执行完毕');
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    // 清除健康检查定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // 清除内存监控定时器
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }

    // 清除关闭超时定时器
    if (this.shutdownTimeoutTimer) {
      clearTimeout(this.shutdownTimeoutTimer);
      this.shutdownTimeoutTimer = null;
    }
  }
}

// ============================================================================
// 零宕机重载管理器类
// ============================================================================

/**
 * 零宕机重载配置
 */
export interface ZeroDowntimeConfig {
  // 重载前的等待时间（毫秒）
  preReloadDelay: number;
  // 重载后的稳定等待时间（毫秒）
  postReloadStabilityDelay: number;
  // 是否启用滚动重载（逐个 Worker 重载）
  rollingReload: boolean;
  // 滚动重载间隔（毫秒）
  rollingInterval: number;
}

/**
 * 默认零宕机重载配置
 */
const DEFAULT_ZERO_DOWNTIME_CONFIG: ZeroDowntimeConfig = {
  // 重载前等待 1 秒
  preReloadDelay: 1000,
  // 重载后稳定等待 3 秒
  postReloadStabilityDelay: 3000,
  // 启用滚动重载
  rollingReload: true,
  // 滚动间隔 2 秒
  rollingInterval: 2000,
};

/**
 * 零宕机重载管理器
 * 协调 PM2 的零宕机重载过程
 */
export class ZeroDowntimeReloader {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置对象
  private config: ZeroDowntimeConfig;

  // 是否正在重载
  private isReloading: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置选项
   */
  constructor(config?: Partial<ZeroDowntimeConfig>) {
    // 合并配置
    this.config = {
      ...DEFAULT_ZERO_DOWNTIME_CONFIG,
      ...config,
    };
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 执行零宕机重载
   * 通过 PM2 API 触发重载
   */
  async reload(): Promise<void> {
    // 如果已经在重载中，直接返回
    if (this.isReloading) {
      console.log('[ZeroDowntimeReloader] 重载已在进行中，跳过');
      return;
    }

    // 标记正在重载
    this.isReloading = true;

    try {
      // 记录开始
      console.log('[ZeroDowntimeReloader] 开始零宕机重载');

      // 重载前等待
      await this.delay(this.config.preReloadDelay);

      // 触发 PM2 重载
      await this.triggerPM2Reload();

      // 重载后稳定等待
      await this.delay(this.config.postReloadStabilityDelay);

      // 记录完成
      console.log('[ZeroDowntimeReloader] 零宕机重载完成');
    } finally {
      // 清除重载标记
      this.isReloading = false;
    }
  }

  /**
   * 检查是否正在重载
   * @returns 是否正在重载
   */
  isReloadingNow(): boolean {
    return this.isReloading;
  }

  // ========================================================================
  // 私有方法
  // ========================================================================

  /**
   * 触发 PM2 重载
   * 使用 PM2 API 执行实际的重载操作
   */
  private async triggerPM2Reload(): Promise<void> {
    // 尝试动态导入 PM2 模块
    try {
      const pm2 = await import('pm2');

      // 连接到 PM2 守护进程
      await new Promise<void>((resolve, reject) => {
        pm2.default.connect((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // 获取当前进程名称
      const processName = process.env.name || process.env.pm_id || 'all';

      // 执行重载
      await new Promise<void>((resolve, reject) => {
        pm2.default.reload(processName, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // 断开连接
      pm2.default.disconnect();

      // 记录成功
      console.log(`[ZeroDowntimeReloader] PM2 重载成功: ${processName}`);
    } catch (error) {
      // 记录错误
      console.error('[ZeroDowntimeReloader] PM2 重载失败:', error);

      // 抛出错误
      throw error;
    }
  }

  /**
   * 延迟函数
   * @param ms - 延迟毫秒数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 连接排空器类
// ============================================================================

/**
 * 连接排空器配置
 */
export interface ConnectionDrainerConfig {
  // 排空超时时间（毫秒）
  drainTimeout: number;
  // 检查间隔（毫秒）
  checkInterval: number;
  // 是否强制关闭超时连接
  forceCloseOnTimeout: boolean;
}

/**
 * 默认连接排空器配置
 */
const DEFAULT_CONNECTION_DRAINER_CONFIG: ConnectionDrainerConfig = {
  // 排空超时 10 秒
  drainTimeout: 10000,
  // 检查间隔 500 毫秒
  checkInterval: 500,
  // 超时时强制关闭
  forceCloseOnTimeout: true,
};

/**
 * 连接排空器
 * 在优雅关闭过程中管理活跃连接
 */
export class ConnectionDrainer {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置对象
  private config: ConnectionDrainerConfig;

  // 活跃连接数
  private activeConnections: number = 0;

  // 是否正在排空
  private isDraining: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置选项
   */
  constructor(config?: Partial<ConnectionDrainerConfig>) {
    // 合并配置
    this.config = {
      ...DEFAULT_CONNECTION_DRAINER_CONFIG,
      ...config,
    };
  }

  // ========================================================================
  // 公共方法
  // ========================================================================

  /**
   * 增加连接计数
   */
  addConnection(): void {
    this.activeConnections++;
  }

  /**
   * 减少连接计数
   */
  removeConnection(): void {
    this.activeConnections--;
    // 确保不会变成负数
    if (this.activeConnections < 0) {
      this.activeConnections = 0;
    }
  }

  /**
   * 获取活跃连接数
   * @returns 活跃连接数
   */
  getActiveConnections(): number {
    return this.activeConnections;
  }

  /**
   * 检查是否正在排空
   * @returns 是否正在排空
   */
  isDrainingNow(): boolean {
    return this.isDraining;
  }

  /**
   * 等待所有连接排空
   * @returns Promise，在所有连接关闭或超时后 resolve
   */
  async drain(): Promise<void> {
    // 如果没有活跃连接，直接返回
    if (this.activeConnections === 0) {
      return;
    }

    // 标记正在排空
    this.isDraining = true;

    // 记录开始
    console.log(`[ConnectionDrainer] 开始排空 ${this.activeConnections} 个连接`);

    // 创建排空 Promise
    return new Promise<void>((resolve) => {
      // 记录开始时间
      const startTime = Date.now();

      // 创建检查定时器
      const checkTimer = setInterval(() => {
        // 检查是否所有连接已关闭
        if (this.activeConnections === 0) {
          // 清除定时器
          clearInterval(checkTimer);

          // 记录完成
          console.log('[ConnectionDrainer] 所有连接已排空');

          // 清除排空标记
          this.isDraining = false;

          // 完成
          resolve();
          return;
        }

        // 检查是否超时
        const elapsed = Date.now() - startTime;
        if (elapsed > this.config.drainTimeout) {
          // 清除定时器
          clearInterval(checkTimer);

          // 记录超时
          console.warn(
            `[ConnectionDrainer] 排空超时，剩余 ${this.activeConnections} 个连接`
          );

          // 如果配置了强制关闭，重置计数
          if (this.config.forceCloseOnTimeout) {
            this.activeConnections = 0;
          }

          // 清除排空标记
          this.isDraining = false;

          // 完成（超时也视为完成）
          resolve();
        }
      }, this.config.checkInterval);
    });
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建集群管理器
 * @param config - 配置选项
 * @returns 集群管理器实例
 */
export function createClusterManager(
  config?: Partial<ClusterManagerConfig>
): ClusterManager {
  // 创建并返回实例
  return new ClusterManager(config);
}

/**
 * 创建零宕机重载器
 * @param config - 配置选项
 * @returns 零宕机重载器实例
 */
export function createZeroDowntimeReloader(
  config?: Partial<ZeroDowntimeConfig>
): ZeroDowntimeReloader {
  // 创建并返回实例
  return new ZeroDowntimeReloader(config);
}

/**
 * 创建连接排空器
 * @param config - 配置选项
 * @returns 连接排空器实例
 */
export function createConnectionDrainer(
  config?: Partial<ConnectionDrainerConfig>
): ConnectionDrainer {
  // 创建并返回实例
  return new ConnectionDrainer(config);
}

// 导出默认配置
export {
  DEFAULT_CLUSTER_MANAGER_CONFIG,
  DEFAULT_ZERO_DOWNTIME_CONFIG,
  DEFAULT_CONNECTION_DRAINER_CONFIG,
};
