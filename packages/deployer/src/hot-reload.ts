// ============================================================================
// 策略热加载模块
// 监控 TypeScript 文件变化，自动编译并重新加载策略，无需重启进程
// ============================================================================

// 导入 Node.js 文件系统模块
import * as fs from 'fs';
// 导入 Node.js 路径处理模块
import * as path from 'path';
// 导入 Node.js URL 模块（用于动态导入）
import { pathToFileURL } from 'url';
// 导入事件发射器（用于发布热加载事件）
import { EventEmitter } from 'eventemitter3';
// 导入 chokidar 文件监控库
import chokidar from 'chokidar';
// 导入 esbuild 编译器（用于快速编译 TypeScript）
import * as esbuild from 'esbuild';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 热加载配置接口
 * 定义热加载模块的所有配置选项
 */
export interface HotReloadConfig {
  // 监控的目录路径（策略文件所在目录）
  watchDir: string;
  // 编译输出目录（编译后的 JS 文件存放位置）
  outputDir: string;
  // 文件匹配模式（默认监控所有 .ts 文件）
  pattern: string;
  // 防抖延迟（毫秒），避免频繁重新编译
  debounceMs: number;
  // 是否启用 source map（方便调试）
  sourceMap: boolean;
  // 编译目标（ES 版本）
  target: string;
  // 是否在启动时立即编译所有文件
  compileOnStart: boolean;
  // 忽略的文件/目录模式
  ignorePatterns: string[];
  // 最大编译重试次数
  maxRetries: number;
  // 重试间隔（毫秒）
  retryDelayMs: number;
}

/**
 * 默认热加载配置
 * 提供合理的默认值
 */
const DEFAULT_HOT_RELOAD_CONFIG: HotReloadConfig = {
  // 默认监控当前目录下的 strategies 文件夹
  watchDir: './strategies',
  // 默认输出到 .hot-reload 隐藏目录
  outputDir: './.hot-reload',
  // 默认监控所有 TypeScript 文件
  pattern: '**/*.ts',
  // 默认防抖 500ms（文件修改后等待 500ms 再编译）
  debounceMs: 500,
  // 默认启用 source map
  sourceMap: true,
  // 默认编译目标 ES2022
  target: 'es2022',
  // 默认启动时编译所有文件
  compileOnStart: true,
  // 默认忽略测试文件和类型声明文件
  ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts', '**/node_modules/**'],
  // 最大重试 3 次
  maxRetries: 3,
  // 重试间隔 1 秒
  retryDelayMs: 1000,
};

/**
 * 策略模块接口
 * 定义热加载的策略模块应该具有的结构
 */
export interface StrategyModule {
  // 策略的唯一标识符
  id: string;
  // 策略名称
  name: string;
  // 策略版本
  version: string;
  // 策略初始化函数
  initialize?: () => Promise<void>;
  // 策略销毁函数（用于清理资源）
  destroy?: () => Promise<void>;
  // 策略的其他导出（允许任意属性）
  [key: string]: unknown;
}

/**
 * 已加载模块信息
 * 记录模块的加载状态和元数据
 */
interface LoadedModule {
  // 模块文件路径
  filePath: string;
  // 编译后的 JS 文件路径
  compiledPath: string;
  // 模块实例
  module: StrategyModule | null;
  // 加载时间戳
  loadedAt: number;
  // 模块版本（用于检测更新）
  version: number;
  // 最后修改时间
  lastModified: number;
  // 编译错误信息（如果有）
  error: string | null;
}

/**
 * 热加载事件接口
 * 定义所有可能触发的事件
 */
export interface HotReloadEvents {
  // 文件变化事件（文件路径）
  fileChanged: (filePath: string) => void;
  // 编译开始事件（文件路径）
  compileStart: (filePath: string) => void;
  // 编译成功事件（文件路径，耗时毫秒）
  compileSuccess: (filePath: string, durationMs: number) => void;
  // 编译失败事件（文件路径，错误信息）
  compileError: (filePath: string, error: string) => void;
  // 模块加载事件（模块 ID）
  moduleLoaded: (moduleId: string, module: StrategyModule) => void;
  // 模块卸载事件（模块 ID）
  moduleUnloaded: (moduleId: string) => void;
  // 模块更新事件（模块 ID，旧模块，新模块）
  moduleUpdated: (moduleId: string, oldModule: StrategyModule, newModule: StrategyModule) => void;
  // 错误事件
  error: (error: Error) => void;
  // 监控启动事件
  watcherReady: () => void;
  // 监控停止事件
  watcherStopped: () => void;
}

/**
 * 编译结果接口
 */
interface CompileResult {
  // 是否成功
  success: boolean;
  // 输出文件路径
  outputPath: string;
  // 错误信息（如果失败）
  error?: string;
  // 编译耗时（毫秒）
  durationMs: number;
}

// ============================================================================
// 热加载管理器类
// ============================================================================

/**
 * 策略热加载管理器
 * 负责监控文件变化、编译 TypeScript、动态加载/卸载策略模块
 */
export class HotReloadManager extends EventEmitter<HotReloadEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置对象
  private config: HotReloadConfig;

  // chokidar 文件监控器实例
  private watcher: chokidar.FSWatcher | null = null;

  // 已加载的模块映射（文件路径 -> 模块信息）
  private loadedModules: Map<string, LoadedModule> = new Map();

  // 防抖定时器映射（文件路径 -> 定时器 ID）
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // 模块版本计数器（用于生成唯一的模块版本号）
  private versionCounter: number = 0;

  // 是否正在运行
  private running: boolean = false;

  // 编译锁（防止同一文件并发编译）
  private compileLocks: Set<string> = new Set();

  // esbuild 上下文（用于增量编译）
  private esbuildContexts: Map<string, esbuild.BuildContext> = new Map();

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 热加载配置（可选，使用默认值填充缺失项）
   */
  constructor(config?: Partial<HotReloadConfig>) {
    // 调用父类构造函数
    super();

    // 合并用户配置与默认配置
    this.config = {
      ...DEFAULT_HOT_RELOAD_CONFIG,
      ...config,
    };
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动热加载
   * 开始监控文件变化并编译策略
   */
  async start(): Promise<void> {
    // 如果已经在运行，直接返回
    if (this.running) {
      return;
    }

    // 设置运行状态
    this.running = true;

    // 确保输出目录存在
    await this.ensureOutputDir();

    // 如果配置了启动时编译，则编译所有现有文件
    if (this.config.compileOnStart) {
      // 获取所有匹配的文件
      const files = await this.getMatchingFiles();

      // 并行编译所有文件
      await Promise.all(files.map((file) => this.compileAndLoad(file)));
    }

    // 启动文件监控器
    await this.startWatcher();
  }

  /**
   * 停止热加载
   * 停止监控并卸载所有模块
   */
  async stop(): Promise<void> {
    // 如果没有在运行，直接返回
    if (!this.running) {
      return;
    }

    // 设置运行状态
    this.running = false;

    // 停止文件监控器
    await this.stopWatcher();

    // 卸载所有已加载的模块
    await this.unloadAllModules();

    // 清理所有 esbuild 上下文
    await this.disposeAllEsbuildContexts();

    // 清除所有防抖定时器
    this.clearAllDebounceTimers();
  }

  /**
   * 重新加载所有模块
   * 强制重新编译和加载所有策略
   */
  async reloadAll(): Promise<void> {
    // 获取所有匹配的文件
    const files = await this.getMatchingFiles();

    // 并行重新编译和加载所有文件
    await Promise.all(files.map((file) => this.compileAndLoad(file)));
  }

  /**
   * 重新加载指定模块
   * @param filePath - 要重新加载的文件路径
   */
  async reload(filePath: string): Promise<void> {
    // 获取绝对路径
    const absolutePath = path.resolve(filePath);

    // 编译并加载模块
    await this.compileAndLoad(absolutePath);
  }

  // ========================================================================
  // 公共方法 - 模块查询
  // ========================================================================

  /**
   * 获取已加载的模块
   * @param moduleId - 模块 ID
   * @returns 策略模块实例，如果未找到返回 null
   */
  getModule(moduleId: string): StrategyModule | null {
    // 遍历所有已加载模块
    for (const loaded of this.loadedModules.values()) {
      // 如果模块存在且 ID 匹配
      if (loaded.module && loaded.module.id === moduleId) {
        // 返回模块实例
        return loaded.module;
      }
    }

    // 未找到，返回 null
    return null;
  }

  /**
   * 获取所有已加载的模块
   * @returns 模块 ID 到模块实例的映射
   */
  getAllModules(): Map<string, StrategyModule> {
    // 创建结果映射
    const result = new Map<string, StrategyModule>();

    // 遍历所有已加载模块
    for (const loaded of this.loadedModules.values()) {
      // 如果模块存在
      if (loaded.module) {
        // 添加到结果映射
        result.set(loaded.module.id, loaded.module);
      }
    }

    // 返回结果
    return result;
  }

  /**
   * 获取模块加载状态
   * @param filePath - 文件路径
   * @returns 模块加载信息，如果未加载返回 null
   */
  getModuleStatus(filePath: string): LoadedModule | null {
    // 获取绝对路径
    const absolutePath = path.resolve(filePath);

    // 返回模块信息
    return this.loadedModules.get(absolutePath) || null;
  }

  /**
   * 检查模块是否已加载
   * @param moduleId - 模块 ID
   * @returns 是否已加载
   */
  isModuleLoaded(moduleId: string): boolean {
    // 使用 getModule 检查
    return this.getModule(moduleId) !== null;
  }

  // ========================================================================
  // 私有方法 - 文件监控
  // ========================================================================

  /**
   * 启动文件监控器
   * 使用 chokidar 监控策略目录的文件变化
   */
  private async startWatcher(): Promise<void> {
    // 构建监控路径（监控目录 + 文件模式）
    const watchPath = path.join(this.config.watchDir, this.config.pattern);

    // 创建 chokidar 监控器
    this.watcher = chokidar.watch(watchPath, {
      // 忽略的文件模式
      ignored: this.config.ignorePatterns,
      // 持久化监控（不自动退出）
      persistent: true,
      // 忽略初始扫描时的 add 事件
      ignoreInitial: true,
      // 等待文件写入完成
      awaitWriteFinish: {
        // 文件大小稳定后的等待时间
        stabilityThreshold: 100,
        // 轮询间隔
        pollInterval: 100,
      },
      // 使用轮询（某些系统上更可靠）
      usePolling: false,
      // 轮询间隔（如果启用轮询）
      interval: 100,
    });

    // 监听文件添加事件
    this.watcher.on('add', (filePath: string) => {
      // 处理文件变化（带防抖）
      this.handleFileChange(filePath);
    });

    // 监听文件修改事件
    this.watcher.on('change', (filePath: string) => {
      // 处理文件变化（带防抖）
      this.handleFileChange(filePath);
    });

    // 监听文件删除事件
    this.watcher.on('unlink', (filePath: string) => {
      // 处理文件删除
      this.handleFileDelete(filePath);
    });

    // 监听错误事件
    this.watcher.on('error', (error: Error) => {
      // 发出错误事件
      this.emit('error', error);
    });

    // 监听就绪事件
    this.watcher.on('ready', () => {
      // 发出就绪事件
      this.emit('watcherReady');
    });
  }

  /**
   * 停止文件监控器
   */
  private async stopWatcher(): Promise<void> {
    // 如果监控器存在
    if (this.watcher) {
      // 关闭监控器
      await this.watcher.close();
      // 清空引用
      this.watcher = null;
      // 发出停止事件
      this.emit('watcherStopped');
    }
  }

  /**
   * 处理文件变化
   * 使用防抖机制避免频繁编译
   * @param filePath - 变化的文件路径
   */
  private handleFileChange(filePath: string): void {
    // 获取绝对路径
    const absolutePath = path.resolve(filePath);

    // 发出文件变化事件
    this.emit('fileChanged', absolutePath);

    // 清除之前的防抖定时器（如果存在）
    const existingTimer = this.debounceTimers.get(absolutePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // 设置新的防抖定时器
    const timer = setTimeout(() => {
      // 从映射中移除定时器
      this.debounceTimers.delete(absolutePath);
      // 编译并加载模块
      this.compileAndLoad(absolutePath).catch((error) => {
        // 发出错误事件
        this.emit('error', error as Error);
      });
    }, this.config.debounceMs);

    // 保存定时器引用
    this.debounceTimers.set(absolutePath, timer);
  }

  /**
   * 处理文件删除
   * @param filePath - 被删除的文件路径
   */
  private handleFileDelete(filePath: string): void {
    // 获取绝对路径
    const absolutePath = path.resolve(filePath);

    // 卸载该文件对应的模块
    this.unloadModule(absolutePath).catch((error) => {
      // 发出错误事件
      this.emit('error', error as Error);
    });
  }

  // ========================================================================
  // 私有方法 - 编译
  // ========================================================================

  /**
   * 编译 TypeScript 文件
   * 使用 esbuild 进行快速编译
   * @param filePath - 要编译的文件路径
   * @returns 编译结果
   */
  private async compileFile(filePath: string): Promise<CompileResult> {
    // 记录开始时间
    const startTime = Date.now();

    // 计算输出文件路径
    const relativePath = path.relative(this.config.watchDir, filePath);
    // 将 .ts 扩展名替换为 .mjs（ESM 模块）
    const outputFileName = relativePath.replace(/\.ts$/, '.mjs');
    // 构建完整输出路径
    const outputPath = path.join(this.config.outputDir, outputFileName);

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.promises.mkdir(outputDir, { recursive: true });

    try {
      // 发出编译开始事件
      this.emit('compileStart', filePath);

      // 使用 esbuild 编译
      await esbuild.build({
        // 入口文件
        entryPoints: [filePath],
        // 输出文件
        outfile: outputPath,
        // 打包模式（不打包依赖）
        bundle: false,
        // 输出格式（ESM）
        format: 'esm',
        // 平台（Node.js）
        platform: 'node',
        // 编译目标
        target: this.config.target,
        // source map
        sourcemap: this.config.sourceMap,
        // 保留原始文件名（用于调试）
        keepNames: true,
        // 不压缩（方便调试）
        minify: false,
        // 输出元数据
        metafile: false,
      });

      // 计算编译耗时
      const durationMs = Date.now() - startTime;

      // 发出编译成功事件
      this.emit('compileSuccess', filePath, durationMs);

      // 返回成功结果
      return {
        success: true,
        outputPath,
        durationMs,
      };
    } catch (error) {
      // 计算编译耗时
      const durationMs = Date.now() - startTime;

      // 构建错误消息
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 发出编译失败事件
      this.emit('compileError', filePath, errorMessage);

      // 返回失败结果
      return {
        success: false,
        outputPath,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * 编译并加载模块
   * 完整的编译-加载流程
   * @param filePath - 文件路径
   */
  private async compileAndLoad(filePath: string): Promise<void> {
    // 检查编译锁（防止并发编译同一文件）
    if (this.compileLocks.has(filePath)) {
      // 已经在编译中，跳过
      return;
    }

    // 获取编译锁
    this.compileLocks.add(filePath);

    try {
      // 编译文件
      const result = await this.compileFile(filePath);

      // 如果编译失败
      if (!result.success) {
        // 更新模块状态（记录错误）
        const existingModule = this.loadedModules.get(filePath);
        if (existingModule) {
          existingModule.error = result.error || 'Unknown compile error';
        } else {
          // 创建新的模块记录
          this.loadedModules.set(filePath, {
            filePath,
            compiledPath: result.outputPath,
            module: null,
            loadedAt: 0,
            version: 0,
            lastModified: Date.now(),
            error: result.error || 'Unknown compile error',
          });
        }
        return;
      }

      // 加载编译后的模块
      await this.loadModule(filePath, result.outputPath);
    } finally {
      // 释放编译锁
      this.compileLocks.delete(filePath);
    }
  }

  // ========================================================================
  // 私有方法 - 模块加载
  // ========================================================================

  /**
   * 加载模块
   * 动态导入编译后的 JS 文件
   * @param sourcePath - 源文件路径
   * @param compiledPath - 编译后的文件路径
   */
  private async loadModule(sourcePath: string, compiledPath: string): Promise<void> {
    // 获取旧模块（如果存在）
    const existingModule = this.loadedModules.get(sourcePath);
    const oldModule = existingModule?.module;

    // 如果旧模块存在且有销毁方法，先销毁
    if (oldModule && typeof oldModule.destroy === 'function') {
      try {
        // 调用销毁方法
        await oldModule.destroy();
      } catch (error) {
        // 销毁失败，记录错误但继续
        this.emit('error', error as Error);
      }
    }

    // 生成新版本号
    const newVersion = ++this.versionCounter;

    // 构建模块 URL（添加版本参数以绕过缓存）
    const moduleUrl = pathToFileURL(compiledPath).href + `?v=${newVersion}`;

    try {
      // 动态导入模块
      const importedModule = await import(moduleUrl);

      // 获取默认导出或整个模块
      const strategyModule: StrategyModule = importedModule.default || importedModule;

      // 验证模块结构
      if (!strategyModule.id || typeof strategyModule.id !== 'string') {
        throw new Error('Strategy module must export an "id" property');
      }

      // 如果有初始化方法，调用它
      if (typeof strategyModule.initialize === 'function') {
        await strategyModule.initialize();
      }

      // 获取文件修改时间
      const stats = await fs.promises.stat(sourcePath);

      // 更新模块记录
      this.loadedModules.set(sourcePath, {
        filePath: sourcePath,
        compiledPath,
        module: strategyModule,
        loadedAt: Date.now(),
        version: newVersion,
        lastModified: stats.mtimeMs,
        error: null,
      });

      // 发出相应事件
      if (oldModule) {
        // 模块更新事件
        this.emit('moduleUpdated', strategyModule.id, oldModule, strategyModule);
      } else {
        // 模块加载事件
        this.emit('moduleLoaded', strategyModule.id, strategyModule);
      }
    } catch (error) {
      // 加载失败
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 更新模块记录（记录错误）
      this.loadedModules.set(sourcePath, {
        filePath: sourcePath,
        compiledPath,
        module: existingModule?.module || null, // 保留旧模块
        loadedAt: existingModule?.loadedAt || 0,
        version: existingModule?.version || 0,
        lastModified: Date.now(),
        error: errorMessage,
      });

      // 发出错误事件
      this.emit('error', new Error(`Failed to load module ${sourcePath}: ${errorMessage}`));
    }
  }

  /**
   * 卸载模块
   * @param sourcePath - 源文件路径
   */
  private async unloadModule(sourcePath: string): Promise<void> {
    // 获取模块记录
    const moduleInfo = this.loadedModules.get(sourcePath);

    // 如果不存在，直接返回
    if (!moduleInfo) {
      return;
    }

    // 获取模块实例
    const { module: strategyModule } = moduleInfo;

    // 如果模块存在
    if (strategyModule) {
      // 如果有销毁方法，调用它
      if (typeof strategyModule.destroy === 'function') {
        try {
          await strategyModule.destroy();
        } catch (error) {
          // 销毁失败，记录错误但继续
          this.emit('error', error as Error);
        }
      }

      // 发出卸载事件
      this.emit('moduleUnloaded', strategyModule.id);
    }

    // 删除编译后的文件
    try {
      await fs.promises.unlink(moduleInfo.compiledPath);
    } catch {
      // 忽略删除失败的错误
    }

    // 从映射中移除
    this.loadedModules.delete(sourcePath);
  }

  /**
   * 卸载所有模块
   */
  private async unloadAllModules(): Promise<void> {
    // 获取所有模块路径
    const paths = Array.from(this.loadedModules.keys());

    // 并行卸载所有模块
    await Promise.all(paths.map((path) => this.unloadModule(path)));
  }

  // ========================================================================
  // 私有方法 - 工具方法
  // ========================================================================

  /**
   * 确保输出目录存在
   */
  private async ensureOutputDir(): Promise<void> {
    // 创建目录（如果不存在）
    await fs.promises.mkdir(this.config.outputDir, { recursive: true });
  }

  /**
   * 获取所有匹配的文件
   * @returns 匹配文件路径数组
   */
  private async getMatchingFiles(): Promise<string[]> {
    // 结果数组
    const files: string[] = [];

    // 递归扫描目录
    const scanDir = async (dir: string): Promise<void> => {
      // 读取目录内容
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      // 遍历目录项
      for (const entry of entries) {
        // 构建完整路径
        const fullPath = path.join(dir, entry.name);

        // 如果是目录
        if (entry.isDirectory()) {
          // 检查是否应该忽略
          const shouldIgnore = this.config.ignorePatterns.some((pattern) =>
            fullPath.includes(pattern.replace('**/', '').replace('/**', ''))
          );

          // 如果不忽略，递归扫描
          if (!shouldIgnore) {
            await scanDir(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          // 如果是 TypeScript 文件，检查是否应该忽略
          const shouldIgnore = this.config.ignorePatterns.some((pattern) => {
            // 简单的模式匹配
            if (pattern.includes('*.test.ts') && entry.name.endsWith('.test.ts')) {
              return true;
            }
            if (pattern.includes('*.spec.ts') && entry.name.endsWith('.spec.ts')) {
              return true;
            }
            if (pattern.includes('*.d.ts') && entry.name.endsWith('.d.ts')) {
              return true;
            }
            return false;
          });

          // 如果不忽略，添加到结果
          if (!shouldIgnore) {
            files.push(fullPath);
          }
        }
      }
    };

    // 开始扫描
    try {
      await scanDir(this.config.watchDir);
    } catch {
      // 目录不存在或无法访问，返回空数组
    }

    // 返回结果
    return files;
  }

  /**
   * 清除所有防抖定时器
   */
  private clearAllDebounceTimers(): void {
    // 遍历所有定时器
    for (const timer of this.debounceTimers.values()) {
      // 清除定时器
      clearTimeout(timer);
    }

    // 清空映射
    this.debounceTimers.clear();
  }

  /**
   * 清理所有 esbuild 上下文
   */
  private async disposeAllEsbuildContexts(): Promise<void> {
    // 遍历所有上下文
    for (const context of this.esbuildContexts.values()) {
      // 销毁上下文
      await context.dispose();
    }

    // 清空映射
    this.esbuildContexts.clear();
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建热加载管理器
 * @param config - 配置选项
 * @returns 热加载管理器实例
 */
export function createHotReloadManager(config?: Partial<HotReloadConfig>): HotReloadManager {
  // 创建并返回实例
  return new HotReloadManager(config);
}

// 导出默认配置
export { DEFAULT_HOT_RELOAD_CONFIG };
