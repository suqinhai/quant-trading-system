// ============================================================================
// 实盘交易引擎
// 核心交易逻辑协调器
// ============================================================================

import Decimal from 'decimal.js';
import EventEmitter from 'eventemitter3';
import pino from 'pino';

import type { BaseExchange, OrderRequest, Position } from '@quant/exchange';
import { MarketDataEngine } from '@quant/marketdata';
import type { Kline } from '@quant/marketdata';
import { RiskManager } from '@quant/risk';
import { OrderExecutor } from '@quant/executor';
import { MonitorCenter } from '@quant/monitor';
import type { BaseStrategy, Signal } from '@quant/strategy';

import type { AppConfig, StrategySettings } from './config.js';

// ============================================================================
// 交易引擎事件
// ============================================================================

/**
 * 交易引擎事件
 */
export interface TradingEngineEvents {
  // 引擎启动
  started: () => void;

  // 引擎停止
  stopped: () => void;

  // 收到信号
  signalReceived: (strategyName: string, signal: Signal) => void;

  // 订单执行
  orderExecuted: (strategyName: string, order: OrderRequest) => void;

  // 持仓更新
  positionUpdated: (symbol: string, position: Position | null) => void;

  // 错误
  error: (error: Error) => void;
}

// ============================================================================
// 交易引擎
// ============================================================================

/**
 * 实盘交易引擎
 *
 * 功能：
 * - 协调各模块工作
 * - 接收行情数据
 * - 执行策略逻辑
 * - 管理订单执行
 * - 风控集成
 * - 监控告警
 */
export class TradingEngine extends EventEmitter<TradingEngineEvents> {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 配置
  private readonly config: AppConfig;

  // 交易所实例
  private readonly exchange: BaseExchange;

  // 行情引擎
  private readonly marketData: MarketDataEngine;

  // 风控管理器
  private readonly riskManager: RiskManager;

  // 订单执行器
  private readonly executor: OrderExecutor;

  // 监控中心
  private readonly monitor: MonitorCenter;

  // 策略映射
  private readonly strategies: Map<string, BaseStrategy> = new Map();

  // 策略配置映射
  private readonly strategyConfigs: Map<string, StrategySettings> = new Map();

  // 是否正在运行
  private running: boolean = false;

  // K线数据缓存（策略需要历史数据）
  private readonly klineCache: Map<string, Kline[]> = new Map();

  /**
   * 构造函数
   */
  public constructor(
    config: AppConfig,
    exchange: BaseExchange,
    strategies: Map<string, BaseStrategy>
  ) {
    super();

    this.config = config;
    this.exchange = exchange;
    this.strategies = strategies;

    // 初始化日志
    this.logger = pino({
      name: 'TradingEngine',
      level: config.logLevel,
    });

    // 初始化风控管理器
    this.riskManager = new RiskManager(config.risk);

    // 初始化行情引擎
    this.marketData = new MarketDataEngine(exchange, {
      maxKlineHistory: 500,
      orderBookDepth: 20,
      enableOrderBook: true,
      enableTicker: true,
      enableKline: true,
    });

    // 初始化订单执行器
    this.executor = new OrderExecutor(exchange, config.executor, this.riskManager);

    // 初始化监控中心
    this.monitor = new MonitorCenter(config.monitor);

    // 存储策略配置
    for (const strategyConfig of config.strategies) {
      this.strategyConfigs.set(strategyConfig.name, strategyConfig);
    }

    // 设置事件监听
    this.setupEventListeners();

    this.logger.info('TradingEngine initialized');
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    // 监听 K线更新
    this.marketData.on('kline', (symbol: string, kline: Kline) => {
      this.handleKlineUpdate(symbol, kline);
    });

    // 监听执行器事件
    this.executor.on('executionCompleted', result => {
      this.logger.info(
        {
          requestId: result.requestId,
          filledAmount: result.filledAmount.toString(),
          avgPrice: result.avgPrice.toString(),
        },
        'Execution completed'
      );

      // 更新监控指标
      this.monitor.getMetricsCollector().recordOrder('success');
      this.monitor.getMetricsCollector().recordTrade(
        result.filledAmount,
        result.filledAmount.times(result.avgPrice),
        result.totalFee
      );
    });

    this.executor.on('executionFailed', result => {
      this.logger.error(
        { requestId: result.requestId, reason: result.failReason },
        'Execution failed'
      );

      // 更新监控指标
      this.monitor.getMetricsCollector().recordOrder('failed');

      // 发送告警
      this.monitor.alert(
        'trading',
        'warning',
        'Order Execution Failed',
        `Order execution failed: ${result.failReason}`,
        'executor'
      );
    });

    // 监听风控事件
    this.riskManager.on('ruleTriggered', (ruleName, result) => {
      this.logger.warn({ ruleName, result }, 'Risk rule triggered');

      // 发送告警
      this.monitor.alert(
        'risk',
        result.level === 'high' ? 'critical' : 'warning',
        `Risk Rule Triggered: ${ruleName}`,
        result.reason,
        'risk_manager',
        { ruleName, result }
      );
    });

    this.riskManager.on('circuitBreaker', reason => {
      this.logger.error({ reason }, 'Circuit breaker triggered');

      // 发送紧急告警
      this.monitor.alert(
        'risk',
        'emergency',
        'Circuit Breaker Triggered',
        `Trading halted: ${reason}`,
        'risk_manager'
      );

      // 停止交易
      this.stop();
    });
  }

  // ==========================================================================
  // 生命周期
  // ==========================================================================

  /**
   * 启动交易引擎
   */
  public async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('TradingEngine already running');
      return;
    }

    this.logger.info('Starting TradingEngine...');

    try {
      // 连接交易所
      await this.exchange.connect();
      this.logger.info('Exchange connected');

      // 初始化策略
      await this.initializeStrategies();

      // 订阅行情
      await this.subscribeMarketData();

      // 启动监控
      this.monitor.start();

      this.running = true;
      this.emit('started');

      this.logger.info('TradingEngine started successfully');

      // 发送启动通知
      await this.monitor.info(
        'Trading Engine Started',
        `Trading engine started with ${this.strategies.size} strategies`,
        'trading_engine'
      );
    } catch (error) {
      this.logger.error({ error }, 'Failed to start TradingEngine');
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * 停止交易引擎
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping TradingEngine...');

    this.running = false;

    // 取消所有活跃订单
    const activeExecutions = this.executor.getActiveExecutions();
    for (const execution of activeExecutions) {
      await this.executor.cancelExecution(execution.id, 'Engine stopping');
    }

    // 停止行情订阅
    this.marketData.unsubscribeAll();

    // 停止监控
    this.monitor.stop();

    // 断开交易所连接
    await this.exchange.disconnect();

    this.emit('stopped');
    this.logger.info('TradingEngine stopped');

    // 发送停止通知
    await this.monitor.info(
      'Trading Engine Stopped',
      'Trading engine has been stopped',
      'trading_engine'
    );
  }

  /**
   * 初始化策略
   */
  private async initializeStrategies(): Promise<void> {
    for (const [name, strategy] of this.strategies) {
      const strategyConfig = this.strategyConfigs.get(name);
      if (!strategyConfig || !strategyConfig.enabled) {
        continue;
      }

      // 初始化策略
      await strategy.initialize();

      // 监听策略信号
      strategy.on('signal', (signal: Signal) => {
        this.handleSignal(name, signal);
      });

      this.logger.info({ strategyName: name }, 'Strategy initialized');
    }
  }

  /**
   * 订阅行情数据
   */
  private async subscribeMarketData(): Promise<void> {
    // 收集所有策略需要的交易对
    const symbols = new Set<string>();

    for (const [name, _strategy] of this.strategies) {
      const config = this.strategyConfigs.get(name);
      if (config?.enabled) {
        for (const symbol of config.symbols) {
          symbols.add(symbol);
        }
      }
    }

    // 订阅 K线数据
    for (const symbol of symbols) {
      await this.marketData.subscribeKline(symbol, '1m');
      this.logger.info({ symbol }, 'Subscribed to kline');
    }
  }

  // ==========================================================================
  // 行情处理
  // ==========================================================================

  /**
   * 处理 K线更新
   */
  private handleKlineUpdate(symbol: string, kline: Kline): void {
    // 更新 K线缓存
    let klines = this.klineCache.get(symbol);
    if (!klines) {
      klines = [];
      this.klineCache.set(symbol, klines);
    }

    // 添加新 K线（如果是新的）
    if (klines.length === 0 || klines[klines.length - 1]?.timestamp < kline.timestamp) {
      klines.push(kline);

      // 限制缓存大小
      if (klines.length > 500) {
        klines.shift();
      }

      // 通知策略
      this.notifyStrategies(symbol, klines);
    } else if (klines.length > 0 && klines[klines.length - 1]?.timestamp === kline.timestamp) {
      // 更新最新 K线
      klines[klines.length - 1] = kline;
    }
  }

  /**
   * 通知策略处理数据
   */
  private notifyStrategies(symbol: string, klines: Kline[]): void {
    for (const [name, strategy] of this.strategies) {
      const config = this.strategyConfigs.get(name);

      // 检查策略是否订阅了这个交易对
      if (config?.enabled && config.symbols.includes(symbol)) {
        try {
          strategy.onKline(symbol, klines);
        } catch (error) {
          this.logger.error(
            { strategyName: name, symbol, error },
            'Strategy onKline error'
          );
        }
      }
    }
  }

  // ==========================================================================
  // 信号处理
  // ==========================================================================

  /**
   * 处理策略信号
   */
  private async handleSignal(strategyName: string, signal: Signal): Promise<void> {
    this.logger.info({ strategyName, signal }, 'Signal received');
    this.emit('signalReceived', strategyName, signal);

    // 检查是否为模拟交易
    if (this.config.paperTrading) {
      this.logger.info({ strategyName, signal }, 'Paper trading: signal logged only');
      return;
    }

    // 检查交易引擎是否运行中
    if (!this.running) {
      this.logger.warn('Trading engine not running, ignoring signal');
      return;
    }

    // 检查风控
    const riskCheck = this.riskManager.checkOrder({
      symbol: signal.symbol,
      side: signal.side,
      type: 'market',
      amount: signal.amount,
    });

    if (!riskCheck.allowed) {
      this.logger.warn(
        { strategyName, signal, reason: riskCheck.reason },
        'Signal rejected by risk manager'
      );
      return;
    }

    // 应用风控修改（如调整数量）
    const finalAmount = riskCheck.modifications?.adjustedAmount ?? signal.amount;

    // 创建订单请求
    const orderRequest: OrderRequest = {
      symbol: signal.symbol,
      side: signal.side,
      type: 'market',
      amount: new Decimal(finalAmount),
      price: signal.price ? new Decimal(signal.price) : undefined,
    };

    // 执行订单
    try {
      const result = await this.executor.execute(orderRequest, 'market');

      if (result.status === 'completed') {
        this.logger.info(
          {
            strategyName,
            symbol: signal.symbol,
            side: signal.side,
            filledAmount: result.filledAmount.toString(),
            avgPrice: result.avgPrice.toString(),
          },
          'Order executed successfully'
        );

        this.emit('orderExecuted', strategyName, orderRequest);
      } else {
        this.logger.warn(
          { strategyName, result },
          'Order execution incomplete'
        );
      }
    } catch (error) {
      this.logger.error(
        { strategyName, signal, error },
        'Order execution failed'
      );

      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  // ==========================================================================
  // 状态查询
  // ==========================================================================

  /**
   * 获取运行状态
   */
  public isRunning(): boolean {
    return this.running;
  }

  /**
   * 获取交易统计
   */
  public getTradingStats() {
    return this.monitor.getTradingStats();
  }

  /**
   * 获取系统健康状态
   */
  public getHealth() {
    return this.monitor.getHealth();
  }

  /**
   * 获取活跃告警
   */
  public getActiveAlerts() {
    return this.monitor.getActiveAlerts();
  }

  /**
   * 获取风控状态
   */
  public getRiskState() {
    return this.riskManager.getState();
  }

  /**
   * 获取活跃执行
   */
  public getActiveExecutions() {
    return this.executor.getActiveExecutions();
  }

  /**
   * 获取监控中心实例
   */
  public getMonitor(): MonitorCenter {
    return this.monitor;
  }
}
