// ============================================================================
// PM2 生态系统配置文件
// 用于管理量化交易系统的生产环境部署
// ============================================================================

module.exports = {
  apps: [
    // ========================================================================
    // 实盘交易主程序
    // ========================================================================
    {
      // 应用名称，用于 PM2 管理
      name: 'quant-live',

      // 入口脚本路径
      script: './apps/live/dist/index.js',

      // === 实例配置 ===
      // 实例数量：实盘交易建议单实例运行，避免订单重复
      instances: 1,

      // 执行模式：fork（单进程）或 cluster（集群）
      // 量化交易使用 fork 模式，确保状态一致性
      exec_mode: 'fork',

      // === 环境配置 ===
      env: {
        // Node.js 环境
        NODE_ENV: 'development',
        // 应用端口
        PORT: 3000,
        // 日志级别
        LOG_LEVEL: 'debug',
      },

      // 生产环境变量
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        LOG_LEVEL: 'info',
      },

      // === 日志配置 ===
      // 输出日志文件路径
      out_file: './logs/live-out.log',
      // 错误日志文件路径
      error_file: './logs/live-error.log',
      // 合并 stdout 和 stderr 到一个文件
      merge_logs: true,
      // 日志时间戳格式
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',

      // === 重启策略 ===
      // 文件变化时自动重启（生产环境应关闭）
      watch: false,
      // 监视忽略的目录
      ignore_watch: ['node_modules', 'logs', 'data'],

      // 最大内存限制，超过后自动重启（防止内存泄漏）
      max_memory_restart: '1G',

      // 重启延迟（毫秒）- 避免快速重启导致的问题
      restart_delay: 5000,

      // 最大重启次数（在指定时间窗口内）
      max_restarts: 10,

      // 重启时间窗口（毫秒）
      min_uptime: 60000,

      // === 异常处理 ===
      // 自动重启开关
      autorestart: true,

      // 优雅关闭超时时间（毫秒）
      // 给予足够时间完成当前订单操作
      kill_timeout: 30000,

      // 监听关闭信号
      listen_timeout: 10000,

      // === 源码映射 ===
      // 启用 source map 支持，方便生产环境调试
      source_map_support: true,

      // === Node.js 参数 ===
      node_args: [
        // 启用 source map 支持
        '--enable-source-maps',
        // 增加堆内存限制（量化计算可能需要较大内存）
        '--max-old-space-size=4096',
      ],
    },

    // ========================================================================
    // 回测启动器
    // ========================================================================
    {
      name: 'quant-backtest',

      script: './apps/backtest/dist/index.js',

      // 回测可以使用多实例并行处理不同策略
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        LOG_LEVEL: 'debug',
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        LOG_LEVEL: 'info',
      },

      // 日志配置
      out_file: './logs/backtest-out.log',
      error_file: './logs/backtest-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',

      // 回测可能需要更多内存
      max_memory_restart: '4G',

      // 回测完成后不自动重启
      autorestart: false,

      // Node.js 参数
      node_args: [
        '--enable-source-maps',
        // 回测需要更大的堆内存
        '--max-old-space-size=8192',
      ],
    },

    // ========================================================================
    // 监控告警服务
    // ========================================================================
    {
      name: 'quant-monitor',

      script: './packages/monitor/dist/standalone.js',

      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'development',
        PORT: 3002,
        LOG_LEVEL: 'debug',
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3002,
        LOG_LEVEL: 'info',
      },

      out_file: './logs/monitor-out.log',
      error_file: './logs/monitor-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',

      // 监控服务必须保持运行
      autorestart: true,
      max_restarts: 50,
      restart_delay: 1000,

      max_memory_restart: '512M',

      node_args: ['--enable-source-maps'],
    },
  ],

  // ==========================================================================
  // 部署配置
  // ==========================================================================
  deploy: {
    production: {
      // SSH 用户
      user: 'deploy',

      // 目标服务器（可以是数组，支持多服务器部署）
      host: ['your-server.com'],

      // Git 分支
      ref: 'origin/main',

      // Git 仓库地址
      repo: 'git@github.com:your-org/quant-trading-system.git',

      // 服务器上的部署路径
      path: '/var/www/quant-trading-system',

      // 部署后执行的命令
      'post-deploy':
        'pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production',

      // 部署前在本地执行的命令
      'pre-deploy-local': 'echo "Deploying to production..."',

      // SSH 选项
      ssh_options: ['StrictHostKeyChecking=no', 'PasswordAuthentication=no'],
    },

    staging: {
      user: 'deploy',
      host: ['staging-server.com'],
      ref: 'origin/develop',
      repo: 'git@github.com:your-org/quant-trading-system.git',
      path: '/var/www/quant-trading-system-staging',
      'post-deploy':
        'pnpm install && pnpm build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};
