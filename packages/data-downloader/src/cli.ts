#!/usr/bin/env node

// ============================================================================
// 数据下载器 CLI 入口
// 提供命令行界面用于批量下载历史数据
// 支持交互式配置和后台运行
// ============================================================================

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';

import {
  type ExchangeId,
  type DataType,
  type DownloadConfig,
  SUPPORTED_EXCHANGES,
  SUPPORTED_DATA_TYPES,
} from './types';

import { ClickHouseDatabase } from './clickhouse';
import { CheckpointManager } from './checkpoint';
import { DataDownloader } from './downloader';
import { createExchangeInstance, fetchMarkets } from './fetcher';

// ============================================================================
// 版本信息
// ============================================================================

// 版本号
const VERSION = '1.0.0';

// 程序描述
const DESCRIPTION = `
Quant Data Downloader - 批量下载交易所历史数据

支持的交易所: ${SUPPORTED_EXCHANGES.join(', ')}
支持的数据类型: ${SUPPORTED_DATA_TYPES.join(', ')}

数据存储: ClickHouse (ReplacingMergeTree 引擎)
`;

// ============================================================================
// 命令行解析
// ============================================================================

// 创建命令行程序
const program = new Command();

// 配置程序
program
  .name('data-downloader')
  .version(VERSION)
  .description(DESCRIPTION);

// ============================================================================
// download 命令 - 下载数据
// ============================================================================

program
  .command('download')
  .description('下载历史数据到 ClickHouse')
  .requiredOption(
    '-e, --exchanges <exchanges>',
    '交易所列表（逗号分隔）',
    'binance,bybit,okx'
  )
  .requiredOption(
    '-s, --symbols <symbols>',
    '交易对列表（逗号分隔）',
    'BTC/USDT:USDT,ETH/USDT:USDT'
  )
  .requiredOption(
    '-t, --types <types>',
    '数据类型列表（逗号分隔）',
    'kline,funding_rate'
  )
  .requiredOption(
    '--start <date>',
    '开始日期（YYYY-MM-DD 或毫秒时间戳）',
    '2020-01-01'
  )
  .option(
    '--end <date>',
    '结束日期（默认当前时间）'
  )
  .option(
    '--host <host>',
    'ClickHouse 主机',
    'localhost'
  )
  .option(
    '--port <port>',
    'ClickHouse 端口',
    '8123'
  )
  .option(
    '--database <database>',
    'ClickHouse 数据库',
    'quant'
  )
  .option(
    '--username <username>',
    'ClickHouse 用户名',
    'default'
  )
  .option(
    '--password <password>',
    'ClickHouse 密码',
    ''
  )
  .option(
    '-c, --concurrency <number>',
    '并发下载数',
    '3'
  )
  .option(
    '--delay <ms>',
    '请求间隔（毫秒）',
    '100'
  )
  .option(
    '--no-checkpoint',
    '禁用断点续传'
  )
  .action(async (options) => {
    // 显示启动信息
    console.log(chalk.cyan('\n🚀 Quant Data Downloader\n'));

    // 解析参数
    const exchanges = options.exchanges.split(',').map((e: string) => e.trim()) as ExchangeId[];
    const symbols = options.symbols.split(',').map((s: string) => s.trim());
    const dataTypes = options.types.split(',').map((t: string) => t.trim()) as DataType[];
    const startTime = parseDate(options.start);
    const endTime = options.end ? parseDate(options.end) : Date.now();

    // 验证参数
    for (const exchange of exchanges) {
      if (!SUPPORTED_EXCHANGES.includes(exchange)) {
        console.error(chalk.red(`错误: 不支持的交易所 "${exchange}"`));
        console.error(`支持的交易所: ${SUPPORTED_EXCHANGES.join(', ')}`);
        process.exit(1);
      }
    }

    for (const dataType of dataTypes) {
      if (!SUPPORTED_DATA_TYPES.includes(dataType)) {
        console.error(chalk.red(`错误: 不支持的数据类型 "${dataType}"`));
        console.error(`支持的数据类型: ${SUPPORTED_DATA_TYPES.join(', ')}`);
        process.exit(1);
      }
    }

    // 显示配置
    console.log(chalk.gray('配置:'));
    console.log(chalk.gray(`  交易所: ${exchanges.join(', ')}`));
    console.log(chalk.gray(`  交易对: ${symbols.join(', ')}`));
    console.log(chalk.gray(`  数据类型: ${dataTypes.join(', ')}`));
    console.log(chalk.gray(`  时间范围: ${new Date(startTime).toISOString()} ~ ${new Date(endTime).toISOString()}`));
    console.log(chalk.gray(`  ClickHouse: ${options.host}:${options.port}/${options.database}`));
    console.log();

    // 创建进度条
    const progressBar = new cliProgress.SingleBar({
      format: '{task} |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} | {status}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
    });

    // 当前任务信息
    let currentTask = '';
    let totalDownloaded = 0;

    try {
      // 创建 ClickHouse 客户端
      const spinner = ora('连接 ClickHouse...').start();

      const db = new ClickHouseDatabase({
        host: options.host,
        port: parseInt(options.port, 10),
        database: options.database,
        username: options.username,
        password: options.password,
      });

      // 初始化数据库（自动建表）
      await db.initialize();
      spinner.succeed('ClickHouse 连接成功，表结构已就绪');

      // 创建检查点管理器
      const checkpointManager = options.checkpoint
        ? CheckpointManager.createClickHouseManager(db)
        : await CheckpointManager.createFileManager('./checkpoints');

      // 创建下载配置
      const config: DownloadConfig = {
        exchanges,
        symbols,
        dataTypes,
        startTime,
        endTime,
        concurrency: parseInt(options.concurrency, 10),
        requestDelay: parseInt(options.delay, 10),
        enableCheckpoint: options.checkpoint,
      };

      // 创建下载器
      const downloader = new DataDownloader(db, checkpointManager, config);

      // 监听事件
      downloader.on('start', (exchange, symbol, dataType) => {
        currentTask = `${exchange}/${symbol}/${dataType}`;
        progressBar.start(100, 0, { task: currentTask, status: '下载中...' });
      });

      downloader.on('progress', (event) => {
        progressBar.update(Math.round(event.progress), {
          task: currentTask,
          status: `${event.downloadedCount} 条`,
        });
      });

      downloader.on('complete', (exchange, symbol, dataType, count) => {
        totalDownloaded += count;
        progressBar.update(100, { task: currentTask, status: '完成' });
        progressBar.stop();
        console.log(chalk.green(`✓ ${exchange}/${symbol}/${dataType}: ${count} 条记录`));
      });

      downloader.on('error', (exchange, symbol, dataType, error) => {
        progressBar.stop();
        console.log(chalk.red(`✗ ${exchange}/${symbol}/${dataType}: ${error.message}`));
      });

      downloader.on('skip', (exchange, symbol, dataType, reason) => {
        console.log(chalk.yellow(`⊘ ${exchange}/${symbol}/${dataType}: ${reason}`));
      });

      // 处理退出信号
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n\n正在停止下载...'));
        downloader.stop();
      });

      // 开始下载
      console.log(chalk.cyan('\n开始下载数据...\n'));
      const startTimestamp = Date.now();

      await downloader.start();

      // 完成统计
      const duration = (Date.now() - startTimestamp) / 1000;
      console.log(chalk.green(`\n✓ 下载完成！`));
      console.log(chalk.gray(`  总记录数: ${totalDownloaded.toLocaleString()}`));
      console.log(chalk.gray(`  耗时: ${duration.toFixed(1)} 秒`));
      console.log(chalk.gray(`  速度: ${(totalDownloaded / duration).toFixed(1)} 条/秒`));

      // 关闭数据库连接
      await db.close();

    } catch (error) {
      progressBar.stop();
      console.error(chalk.red(`\n错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================================================
// update 命令 - 增量更新
// ============================================================================

program
  .command('update')
  .description('增量更新数据（从上次下载位置继续）')
  .option(
    '-e, --exchanges <exchanges>',
    '交易所列表',
    'binance,bybit,okx'
  )
  .option(
    '-s, --symbols <symbols>',
    '交易对列表',
    'BTC/USDT:USDT,ETH/USDT:USDT'
  )
  .option(
    '-t, --types <types>',
    '数据类型列表',
    'kline,funding_rate'
  )
  .option('--host <host>', 'ClickHouse 主机', 'localhost')
  .option('--port <port>', 'ClickHouse 端口', '8123')
  .option('--database <database>', 'ClickHouse 数据库', 'quant')
  .option('--username <username>', 'ClickHouse 用户名', 'default')
  .option('--password <password>', 'ClickHouse 密码', '')
  .action(async (options) => {
    console.log(chalk.cyan('\n🔄 增量更新数据...\n'));

    const exchanges = options.exchanges.split(',').map((e: string) => e.trim()) as ExchangeId[];
    const symbols = options.symbols.split(',').map((s: string) => s.trim());
    const dataTypes = options.types.split(',').map((t: string) => t.trim()) as DataType[];

    try {
      // 创建数据库客户端
      const db = new ClickHouseDatabase({
        host: options.host,
        port: parseInt(options.port, 10),
        database: options.database,
        username: options.username,
        password: options.password,
      });

      await db.initialize();

      // 创建检查点管理器
      const checkpointManager = CheckpointManager.createClickHouseManager(db);

      // 创建下载器（从 2020 年开始，但会自动从检查点恢复）
      const config: DownloadConfig = {
        exchanges,
        symbols,
        dataTypes,
        startTime: new Date('2020-01-01').getTime(),
        endTime: Date.now(),
        enableCheckpoint: true,
      };

      const downloader = new DataDownloader(db, checkpointManager, config);

      // 监听事件
      downloader.on('complete', (exchange, symbol, dataType, count) => {
        console.log(chalk.green(`✓ ${exchange}/${symbol}/${dataType}: ${count} 条新记录`));
      });

      downloader.on('skip', (exchange, symbol, dataType, reason) => {
        console.log(chalk.yellow(`⊘ ${exchange}/${symbol}/${dataType}: ${reason}`));
      });

      // 执行增量更新
      await downloader.incrementalUpdate();

      console.log(chalk.green('\n✓ 增量更新完成！'));

      await db.close();

    } catch (error) {
      console.error(chalk.red(`错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================================================
// list-symbols 命令 - 列出交易对
// ============================================================================

program
  .command('list-symbols')
  .description('列出交易所支持的交易对')
  .argument('<exchange>', '交易所 ID (binance/bybit/okx)')
  .option('--filter <keyword>', '过滤关键词')
  .action(async (exchange: ExchangeId, options) => {
    console.log(chalk.cyan(`\n📋 ${exchange} 支持的交易对:\n`));

    try {
      // 创建交易所实例
      const spinner = ora('获取交易对列表...').start();
      const ex = createExchangeInstance(exchange);
      const symbols = await fetchMarkets(ex, exchange);
      spinner.succeed(`共 ${symbols.length} 个交易对`);

      // 过滤
      let filtered = symbols;
      if (options.filter) {
        const keyword = options.filter.toUpperCase();
        filtered = symbols.filter((s) =>
          s.symbol.toUpperCase().includes(keyword)
        );
      }

      // 显示
      console.log();
      for (const symbol of filtered) {
        console.log(`  ${symbol.symbol}`);
      }

      console.log(chalk.gray(`\n共 ${filtered.length} 个交易对`));

    } catch (error) {
      console.error(chalk.red(`错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================================================
// status 命令 - 查看下载状态
// ============================================================================

program
  .command('status')
  .description('查看下载进度和状态')
  .option('--host <host>', 'ClickHouse 主机', 'localhost')
  .option('--port <port>', 'ClickHouse 端口', '8123')
  .option('--database <database>', 'ClickHouse 数据库', 'quant')
  .option('--username <username>', 'ClickHouse 用户名', 'default')
  .option('--password <password>', 'ClickHouse 密码', '')
  .action(async (options) => {
    console.log(chalk.cyan('\n📊 下载状态\n'));

    try {
      const db = new ClickHouseDatabase({
        host: options.host,
        port: parseInt(options.port, 10),
        database: options.database,
        username: options.username,
        password: options.password,
      });

      await db.initialize();

      const checkpointManager = CheckpointManager.createClickHouseManager(db);
      const stats = await checkpointManager.getDownloadStats();

      console.log(`  总任务数: ${stats.total}`);
      console.log(chalk.green(`  已完成: ${stats.completed}`));
      console.log(chalk.yellow(`  进行中: ${stats.running}`));
      console.log(chalk.red(`  失败: ${stats.failed}`));
      console.log(chalk.gray(`  待处理: ${stats.pending}`));

      // 获取详细检查点
      const checkpoints = await checkpointManager.getAllCheckpoints();

      if (checkpoints.length > 0) {
        console.log(chalk.cyan('\n检查点详情:\n'));

        for (const cp of checkpoints) {
          const status = cp.status === 'completed' ? chalk.green('✓') :
                        cp.status === 'running' ? chalk.yellow('◎') :
                        cp.status === 'failed' ? chalk.red('✗') : chalk.gray('○');

          console.log(
            `  ${status} ${cp.exchange}/${cp.symbol}/${cp.dataType}: ` +
            `${cp.downloadedCount} 条, ` +
            `最后: ${new Date(cp.lastTimestamp).toISOString()}`
          );
        }
      }

      await db.close();

    } catch (error) {
      console.error(chalk.red(`错误: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 解析日期字符串
 */
function parseDate(dateStr: string): number {
  // 如果是数字，当作时间戳
  if (/^\d+$/.test(dateStr)) {
    return parseInt(dateStr, 10);
  }

  // 否则解析为日期
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`无效的日期格式: ${dateStr}`);
  }

  return date.getTime();
}

// ============================================================================
// 主入口
// ============================================================================

// 解析命令行参数
program.parse(process.argv);

// 如果没有参数，显示帮助
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
