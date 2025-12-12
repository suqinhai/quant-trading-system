// ============================================================================
// @quant/deployer 包主入口
// 策略热加载与 PM2 集群部署模块
// ============================================================================

// ============================================================================
// 热加载模块导出
// ============================================================================

// 导出热加载管理器及其类型
export {
  // 热加载管理器类
  HotReloadManager,
  // 工厂函数
  createHotReloadManager,
  // 默认配置
  DEFAULT_HOT_RELOAD_CONFIG,
  // 类型导出
  type HotReloadConfig,
  type StrategyModule,
  type HotReloadEvents,
} from './hot-reload';

// ============================================================================
// PM2 配置模块导出
// ============================================================================

// 导出 PM2 配置生成器及其类型
export {
  // PM2 配置生成器类
  PM2ConfigGenerator,
  // 工厂函数
  createPM2ConfigGenerator,
  // 默认配置
  DEFAULT_CLUSTER_OPTIONS,
  // 类型导出
  type PM2AppConfig,
  type PM2DeployConfig,
  type PM2EcosystemConfig,
  type ClusterConfigOptions,
} from './pm2-config';

// ============================================================================
// 集群管理模块导出
// ============================================================================

// 导出集群管理器及其类型
export {
  // 集群管理器类
  ClusterManager,
  // 零宕机重载器类
  ZeroDowntimeReloader,
  // 连接排空器类
  ConnectionDrainer,
  // 工厂函数
  createClusterManager,
  createZeroDowntimeReloader,
  createConnectionDrainer,
  // 默认配置
  DEFAULT_CLUSTER_MANAGER_CONFIG,
  DEFAULT_ZERO_DOWNTIME_CONFIG,
  DEFAULT_CONNECTION_DRAINER_CONFIG,
  // 枚举导出
  ProcessState,
  IPCMessageType,
  // 类型导出
  type ClusterManagerConfig,
  type IPCMessage,
  type HealthStatus,
  type ShutdownHook,
  type ClusterManagerEvents,
  type ZeroDowntimeConfig,
  type ConnectionDrainerConfig,
} from './cluster-manager';

// ============================================================================
// 便捷组合函数
// ============================================================================

// 导入所需模块
import { createHotReloadManager, type HotReloadConfig } from './hot-reload';
import { createClusterManager, type ClusterManagerConfig } from './cluster-manager';

/**
 * 部署器配置接口
 * 组合热加载和集群管理的配置
 */
export interface DeployerConfig {
  // 热加载配置
  hotReload?: Partial<HotReloadConfig>;
  // 集群管理配置
  cluster?: Partial<ClusterManagerConfig>;
}

/**
 * 部署器实例接口
 * 包含热加载管理器和集群管理器
 */
export interface DeployerInstance {
  // 热加载管理器
  hotReloadManager: ReturnType<typeof createHotReloadManager>;
  // 集群管理器
  clusterManager: ReturnType<typeof createClusterManager>;
  // 启动函数
  start: () => Promise<void>;
  // 停止函数
  stop: () => Promise<void>;
}

/**
 * 创建完整的部署器实例
 * 包含热加载和集群管理功能
 * @param config - 部署器配置
 * @returns 部署器实例
 */
export function createDeployer(config?: DeployerConfig): DeployerInstance {
  // 创建热加载管理器
  const hotReloadManager = createHotReloadManager(config?.hotReload);

  // 创建集群管理器
  const clusterManager = createClusterManager(config?.cluster);

  // 返回部署器实例
  return {
    // 热加载管理器
    hotReloadManager,

    // 集群管理器
    clusterManager,

    /**
     * 启动部署器
     * 初始化集群管理和热加载
     */
    async start(): Promise<void> {
      // 初始化集群管理器
      await clusterManager.initialize();

      // 启动热加载
      await hotReloadManager.start();

      // 注册关闭钩子
      clusterManager.registerShutdownHook(async () => {
        // 停止热加载
        await hotReloadManager.stop();
      });

      // 监听策略更新事件
      hotReloadManager.on('moduleUpdated', (moduleId) => {
        // 广播策略更新
        clusterManager.broadcastStrategyUpdate(moduleId);
      });

      // 记录日志
      console.log('[Deployer] 部署器已启动');
    },

    /**
     * 停止部署器
     * 优雅关闭所有组件
     */
    async stop(): Promise<void> {
      // 停止热加载
      await hotReloadManager.stop();

      // 记录日志
      console.log('[Deployer] 部署器已停止');
    },
  };
}

// ============================================================================
// 版本信息
// ============================================================================

/**
 * 包版本号
 */
export const VERSION = '1.0.0';

/**
 * 包名称
 */
export const PACKAGE_NAME = '@quant/deployer';
