// ============================================================================
// PM2 集群部署配置生成器
// 生成 PM2 ecosystem 配置文件，支持 4~8 核集群模式
// ============================================================================

// 导入 Node.js 文件系统模块
import * as fs from 'fs';
// 导入 Node.js 路径处理模块
import * as path from 'path';
// 导入 Node.js OS 模块（获取 CPU 核心数）
import * as os from 'os';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * PM2 应用配置接口
 * 定义单个 PM2 应用的所有配置选项
 */
export interface PM2AppConfig {
  // 应用名称（用于 PM2 标识）
  name: string;
  // 入口脚本路径
  script: string;
  // 工作目录
  cwd?: string;
  // 启动参数
  args?: string | string[];
  // Node.js 解释器路径
  interpreter?: string;
  // 解释器参数（如 --experimental-modules）
  interpreter_args?: string | string[];
  // 实例数量（'max' 表示使用所有 CPU 核心）
  instances?: number | 'max';
  // 执行模式：'cluster' 或 'fork'
  exec_mode?: 'cluster' | 'fork';
  // 环境变量
  env?: Record<string, string>;
  // 生产环境变量
  env_production?: Record<string, string>;
  // 开发环境变量
  env_development?: Record<string, string>;
  // 监控文件变化自动重启
  watch?: boolean | string[];
  // 忽略监控的文件
  ignore_watch?: string[];
  // 最大内存限制（超过则重启）
  max_memory_restart?: string;
  // 日志文件路径
  log_file?: string;
  // 错误日志路径
  error_file?: string;
  // 输出日志路径
  out_file?: string;
  // 日志时间格式
  log_date_format?: string;
  // 合并日志（集群模式下所有实例日志合并到一个文件）
  merge_logs?: boolean;
  // 自动重启
  autorestart?: boolean;
  // 最大重启次数
  max_restarts?: number;
  // 重启延迟（毫秒）
  restart_delay?: number;
  // 应用就绪等待时间（毫秒）
  wait_ready?: boolean;
  // 就绪超时时间（毫秒）
  listen_timeout?: number;
  // 优雅关闭超时时间（毫秒）
  kill_timeout?: number;
  // 是否使用 source map 支持
  source_map_support?: boolean;
  // 崩溃时不自动重启
  stop_exit_codes?: number[];
  // 额外的 Node.js 参数
  node_args?: string | string[];
  // 时区
  time?: boolean;
  // 启动脚本（在启动前执行）
  pre_start?: string;
  // 停止脚本（在停止后执行）
  post_stop?: string;
}

/**
 * PM2 部署配置接口
 * 定义远程部署的配置
 */
export interface PM2DeployConfig {
  // 用户名
  user: string;
  // 主机地址
  host: string | string[];
  // SSH 端口
  port?: number;
  // 引用分支
  ref: string;
  // Git 仓库地址
  repo: string;
  // 远程部署路径
  path: string;
  // SSH 私钥路径
  key?: string;
  // 部署前执行的命令
  'pre-deploy'?: string;
  // 部署后执行的命令
  'post-deploy'?: string;
  // 安装前执行的命令
  'pre-setup'?: string;
  // 安装后执行的命令
  'post-setup'?: string;
  // 环境变量
  env?: Record<string, string>;
}

/**
 * PM2 Ecosystem 配置接口
 * 完整的 PM2 配置文件结构
 */
export interface PM2EcosystemConfig {
  // 应用列表
  apps: PM2AppConfig[];
  // 部署配置（可选）
  deploy?: Record<string, PM2DeployConfig>;
}

/**
 * 集群配置生成选项
 */
export interface ClusterConfigOptions {
  // 应用名称
  appName: string;
  // 入口脚本
  script: string;
  // 工作目录
  cwd?: string;
  // CPU 核心数限制（最小值）
  minInstances?: number;
  // CPU 核心数限制（最大值）
  maxInstances?: number;
  // 环境变量
  env?: Record<string, string>;
  // 日志目录
  logDir?: string;
  // 最大内存限制
  maxMemory?: string;
  // 优雅关闭超时
  gracefulShutdownTimeout?: number;
  // 是否启用监控文件变化
  watch?: boolean;
  // 监控忽略模式
  watchIgnore?: string[];
}

/**
 * 默认集群配置选项
 */
const DEFAULT_CLUSTER_OPTIONS: Required<Omit<ClusterConfigOptions, 'appName' | 'script'>> = {
  // 工作目录：当前目录
  cwd: process.cwd(),
  // 最少 4 个实例
  minInstances: 4,
  // 最多 8 个实例
  maxInstances: 8,
  // 默认环境变量
  env: {
    // 生产环境
    NODE_ENV: 'production',
  },
  // 日志目录
  logDir: './logs',
  // 最大内存 1GB
  maxMemory: '1G',
  // 优雅关闭超时 10 秒
  gracefulShutdownTimeout: 10000,
  // 不启用监控（使用热加载替代）
  watch: false,
  // 监控忽略模式
  watchIgnore: ['node_modules', 'logs', '.git', '*.log'],
};

// ============================================================================
// PM2 配置生成器类
// ============================================================================

/**
 * PM2 集群配置生成器
 * 用于生成 PM2 ecosystem 配置文件
 */
export class PM2ConfigGenerator {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 当前 CPU 核心数
  private cpuCount: number;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * 初始化 CPU 核心数
   */
  constructor() {
    // 获取系统 CPU 核心数
    this.cpuCount = os.cpus().length;
  }

  // ========================================================================
  // 公共方法 - 配置生成
  // ========================================================================

  /**
   * 生成集群模式应用配置
   * @param options - 集群配置选项
   * @returns PM2 应用配置
   */
  generateClusterAppConfig(options: ClusterConfigOptions): PM2AppConfig {
    // 合并默认选项
    const opts = {
      ...DEFAULT_CLUSTER_OPTIONS,
      ...options,
    };

    // 计算实例数量
    // 取 CPU 核心数，但限制在 min 和 max 之间
    const instances = Math.max(
      opts.minInstances,
      Math.min(opts.maxInstances, this.cpuCount)
    );

    // 确保日志目录路径是绝对路径或相对于 cwd
    const logDir = opts.logDir.startsWith('/')
      ? opts.logDir
      : path.join(opts.cwd, opts.logDir);

    // 构建应用配置
    const appConfig: PM2AppConfig = {
      // 应用名称
      name: opts.appName,

      // 入口脚本
      script: opts.script,

      // 工作目录
      cwd: opts.cwd,

      // 实例数量（集群模式的核心配置）
      instances: instances,

      // 执行模式：集群模式
      exec_mode: 'cluster',

      // 环境变量
      env: {
        ...opts.env,
        // 添加集群相关环境变量
        CLUSTER_MODE: 'true',
        CLUSTER_INSTANCES: String(instances),
      },

      // 生产环境变量
      env_production: {
        NODE_ENV: 'production',
        ...opts.env,
      },

      // 开发环境变量
      env_development: {
        NODE_ENV: 'development',
        ...opts.env,
      },

      // 监控文件变化（通常关闭，使用热加载替代）
      watch: opts.watch,

      // 忽略监控的文件
      ignore_watch: opts.watchIgnore,

      // 最大内存限制（超过则重启）
      max_memory_restart: opts.maxMemory,

      // 日志配置
      log_file: path.join(logDir, `${opts.appName}.log`),
      error_file: path.join(logDir, `${opts.appName}-error.log`),
      out_file: path.join(logDir, `${opts.appName}-out.log`),
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true, // 合并所有实例的日志

      // 自动重启配置
      autorestart: true,
      max_restarts: 10, // 最大重启 10 次
      restart_delay: 1000, // 重启间隔 1 秒

      // 优雅关闭配置
      wait_ready: true, // 等待应用发送 ready 信号
      listen_timeout: 10000, // 等待 ready 信号的超时时间
      kill_timeout: opts.gracefulShutdownTimeout, // 优雅关闭超时

      // 启用 source map 支持
      source_map_support: true,

      // 进程正常退出时不重启
      stop_exit_codes: [0],

      // Node.js 参数
      node_args: [
        // 启用 ES 模块
        '--experimental-specifier-resolution=node',
        // 增加堆内存限制（与 max_memory_restart 配合）
        '--max-old-space-size=1024',
      ],

      // 启用时间戳
      time: true,
    };

    // 返回配置
    return appConfig;
  }

  /**
   * 生成完整的 ecosystem 配置
   * @param apps - 应用配置列表
   * @param deploy - 部署配置（可选）
   * @returns PM2 Ecosystem 配置
   */
  generateEcosystemConfig(
    apps: PM2AppConfig[],
    deploy?: Record<string, PM2DeployConfig>
  ): PM2EcosystemConfig {
    // 构建完整配置
    const config: PM2EcosystemConfig = {
      apps,
    };

    // 如果有部署配置，添加到结果
    if (deploy) {
      config.deploy = deploy;
    }

    // 返回配置
    return config;
  }

  /**
   * 生成量化交易系统的默认 ecosystem 配置
   * @param options - 基础配置选项
   * @returns PM2 Ecosystem 配置
   */
  generateQuantTradingEcosystem(options: {
    // 项目根目录
    projectRoot: string;
    // 入口脚本
    entryScript?: string;
    // 应用名称
    appName?: string;
    // 环境变量
    env?: Record<string, string>;
  }): PM2EcosystemConfig {
    // 默认值
    const appName = options.appName || 'quant-trading';
    const entryScript = options.entryScript || './dist/index.js';

    // 生成主应用配置
    const mainApp = this.generateClusterAppConfig({
      appName,
      script: entryScript,
      cwd: options.projectRoot,
      env: {
        // 基础环境变量
        NODE_ENV: 'production',
        // 启用优雅关闭
        GRACEFUL_SHUTDOWN: 'true',
        // 热加载目录
        HOT_RELOAD_DIR: './strategies',
        // 监控端口
        MONITOR_PORT: '9090',
        // 自定义环境变量
        ...options.env,
      },
      // 日志目录
      logDir: path.join(options.projectRoot, 'logs'),
      // 最大内存 2GB（交易系统可能需要更多内存）
      maxMemory: '2G',
      // 优雅关闭 15 秒（确保订单处理完成）
      gracefulShutdownTimeout: 15000,
    });

    // 返回完整配置
    return this.generateEcosystemConfig([mainApp]);
  }

  // ========================================================================
  // 公共方法 - 文件操作
  // ========================================================================

  /**
   * 将配置写入文件
   * @param config - PM2 配置对象
   * @param filePath - 输出文件路径
   */
  async writeConfigFile(config: PM2EcosystemConfig, filePath: string): Promise<void> {
    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    // 根据文件扩展名选择格式
    const ext = path.extname(filePath).toLowerCase();

    // 内容变量
    let content: string;

    // 根据扩展名生成不同格式
    if (ext === '.json') {
      // JSON 格式
      content = JSON.stringify(config, null, 2);
    } else if (ext === '.js' || ext === '.cjs') {
      // CommonJS 模块格式
      content = this.generateCommonJSConfig(config);
    } else if (ext === '.mjs') {
      // ES 模块格式
      content = this.generateESModuleConfig(config);
    } else {
      // 默认 JSON 格式
      content = JSON.stringify(config, null, 2);
    }

    // 写入文件
    await fs.promises.writeFile(filePath, content, 'utf-8');
  }

  /**
   * 从文件加载配置
   * @param filePath - 配置文件路径
   * @returns PM2 配置对象
   */
  async loadConfigFile(filePath: string): Promise<PM2EcosystemConfig> {
    // 读取文件内容
    const content = await fs.promises.readFile(filePath, 'utf-8');

    // 根据扩展名解析
    const ext = path.extname(filePath).toLowerCase();

    // 如果是 JSON 文件
    if (ext === '.json') {
      return JSON.parse(content) as PM2EcosystemConfig;
    }

    // 如果是 JS/MJS 文件，使用动态导入
    const absolutePath = path.resolve(filePath);
    const module = await import(absolutePath);
    return module.default || module;
  }

  // ========================================================================
  // 私有方法 - 配置格式化
  // ========================================================================

  /**
   * 生成 CommonJS 格式的配置文件内容
   * @param config - 配置对象
   * @returns CommonJS 模块内容
   */
  private generateCommonJSConfig(config: PM2EcosystemConfig): string {
    // 构建文件内容
    const lines: string[] = [
      '// ============================================================================',
      '// PM2 Ecosystem 配置文件',
      '// 自动生成，请勿手动修改',
      '// ============================================================================',
      '',
      '// 导出配置对象',
      'module.exports = ' + JSON.stringify(config, null, 2) + ';',
      '',
    ];

    // 返回内容
    return lines.join('\n');
  }

  /**
   * 生成 ES 模块格式的配置文件内容
   * @param config - 配置对象
   * @returns ES 模块内容
   */
  private generateESModuleConfig(config: PM2EcosystemConfig): string {
    // 构建文件内容
    const lines: string[] = [
      '// ============================================================================',
      '// PM2 Ecosystem 配置文件',
      '// 自动生成，请勿手动修改',
      '// ============================================================================',
      '',
      '// 导出配置对象',
      'export default ' + JSON.stringify(config, null, 2) + ';',
      '',
    ];

    // 返回内容
    return lines.join('\n');
  }

  // ========================================================================
  // 公共方法 - 工具方法
  // ========================================================================

  /**
   * 获取推荐的实例数量
   * @param min - 最小实例数
   * @param max - 最大实例数
   * @returns 推荐的实例数量
   */
  getRecommendedInstances(min: number = 4, max: number = 8): number {
    // 取 CPU 核心数，但限制在 min 和 max 之间
    return Math.max(min, Math.min(max, this.cpuCount));
  }

  /**
   * 获取 CPU 核心数
   * @returns CPU 核心数
   */
  getCpuCount(): number {
    return this.cpuCount;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建 PM2 配置生成器
 * @returns PM2 配置生成器实例
 */
export function createPM2ConfigGenerator(): PM2ConfigGenerator {
  return new PM2ConfigGenerator();
}

// 导出默认配置
export { DEFAULT_CLUSTER_OPTIONS };
