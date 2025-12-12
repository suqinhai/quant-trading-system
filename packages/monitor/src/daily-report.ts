// ============================================================================
// 每日绩效报告生成器
// 支持生成 PnL 曲线图、保证金率图表、交易统计图
// 使用 SVG 生成图表，可转换为 PNG 发送到 Telegram
// ============================================================================

import type {
  PerformanceReport,
  StrategyPerformance,
  ExchangeMarginRatio,
  ApiStats,
} from './telegram-bot';

// ============================================================================
// 类型定义
// ============================================================================

// 时间序列数据点
export interface TimeSeriesPoint {
  // 时间戳
  timestamp: number;
  // 数值
  value: number;
  // 标签（可选）
  label?: string;
}

// 时间序列数据
export interface TimeSeriesData {
  // 数据名称
  name: string;
  // 数据点
  points: TimeSeriesPoint[];
  // 线条颜色
  color: string;
}

// 柱状图数据
export interface BarChartData {
  // 标签
  label: string;
  // 数值
  value: number;
  // 颜色
  color: string;
}

// 饼图数据
export interface PieChartData {
  // 标签
  label: string;
  // 数值
  value: number;
  // 颜色
  color: string;
}

// 图表配置
export interface ChartConfig {
  // 图表宽度
  width: number;
  // 图表高度
  height: number;
  // 内边距
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  // 背景颜色
  backgroundColor: string;
  // 网格颜色
  gridColor: string;
  // 文字颜色
  textColor: string;
  // 字体
  fontFamily: string;
  // 标题字体大小
  titleFontSize: number;
  // 标签字体大小
  labelFontSize: number;
}

// 默认图表配置
const DEFAULT_CHART_CONFIG: ChartConfig = {
  // 宽度 800px
  width: 800,
  // 高度 400px
  height: 400,
  // 内边距
  padding: {
    top: 60,
    right: 40,
    bottom: 60,
    left: 80,
  },
  // 深色背景
  backgroundColor: '#1a1a2e',
  // 网格颜色
  gridColor: '#2d2d44',
  // 文字颜色
  textColor: '#e0e0e0',
  // 字体
  fontFamily: 'Arial, sans-serif',
  // 标题字体大小
  titleFontSize: 18,
  // 标签字体大小
  labelFontSize: 12,
};

// 报告生成器配置
export interface ReportGeneratorConfig {
  // 图表配置
  chartConfig: ChartConfig;
  // 时区偏移（小时）
  timezoneOffset: number;
  // 颜色主题
  colors: {
    // 盈利颜色
    profit: string;
    // 亏损颜色
    loss: string;
    // 预警颜色（黄色）
    warning: string;
    // 危险颜色（红色）
    danger: string;
    // 安全颜色（绿色）
    safe: string;
    // 系列颜色（用于多条线）
    series: string[];
  };
}

// 默认报告配置
const DEFAULT_REPORT_CONFIG: ReportGeneratorConfig = {
  // 使用默认图表配置
  chartConfig: DEFAULT_CHART_CONFIG,
  // 北京时间
  timezoneOffset: 8,
  // 颜色主题
  colors: {
    // 盈利绿色
    profit: '#00c853',
    // 亏损红色
    loss: '#ff1744',
    // 预警黄色
    warning: '#ffc107',
    // 危险红色
    danger: '#ff5252',
    // 安全绿色
    safe: '#69f0ae',
    // 系列颜色
    series: [
      '#2196f3', // 蓝色
      '#ff9800', // 橙色
      '#9c27b0', // 紫色
      '#00bcd4', // 青色
      '#e91e63', // 粉色
      '#4caf50', // 绿色
      '#ffeb3b', // 黄色
      '#795548', // 棕色
    ],
  },
};

// 历史数据存储
export interface HistoricalData {
  // PnL 历史（时间戳 -> PnL）
  pnlHistory: TimeSeriesPoint[];
  // 权益历史
  equityHistory: TimeSeriesPoint[];
  // 各策略 PnL 历史
  strategyPnlHistory: Map<string, TimeSeriesPoint[]>;
  // 保证金率历史
  marginHistory: Map<string, TimeSeriesPoint[]>;
  // 延迟历史
  latencyHistory: Map<string, TimeSeriesPoint[]>;
  // 交易记录
  trades: TradeRecord[];
}

// 交易记录
export interface TradeRecord {
  // 时间戳
  timestamp: number;
  // 策略
  strategy: string;
  // 交易对
  symbol: string;
  // 方向
  side: 'buy' | 'sell';
  // 数量
  quantity: number;
  // 价格
  price: number;
  // PnL（平仓时）
  pnl?: number;
  // 是否盈利
  isWin?: boolean;
}

// ============================================================================
// 每日报告生成器类
// ============================================================================

/**
 * 每日绩效报告生成器
 * 支持生成各类图表和统计报告
 */
export class DailyReportGenerator {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: ReportGeneratorConfig;

  // 历史数据
  private historicalData: HistoricalData;

  // 当日起始权益
  private dailyStartEquity: number = 0;

  // 当日峰值权益
  private dailyPeakEquity: number = 0;

  // 累计起始权益
  private cumulativeStartEquity: number = 0;

  // 当前日期
  private currentDate: string = '';

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<ReportGeneratorConfig>) {
    // 合并配置
    this.config = {
      ...DEFAULT_REPORT_CONFIG,
      ...config,
      chartConfig: {
        ...DEFAULT_REPORT_CONFIG.chartConfig,
        ...config?.chartConfig,
      },
      colors: {
        ...DEFAULT_REPORT_CONFIG.colors,
        ...config?.colors,
      },
    };

    // 初始化历史数据
    this.historicalData = this.createEmptyHistoricalData();

    // 设置当前日期
    this.currentDate = this.getCurrentDate();
  }

  // ========================================================================
  // 公共方法 - 数据记录
  // ========================================================================

  /**
   * 初始化（设置初始权益）
   * @param initialEquity - 初始权益
   */
  initialize(initialEquity: number): void {
    // 设置起始权益
    this.dailyStartEquity = initialEquity;
    this.dailyPeakEquity = initialEquity;
    this.cumulativeStartEquity = initialEquity;

    // 设置当前日期
    this.currentDate = this.getCurrentDate();

    // 记录初始数据点
    const now = Date.now();

    // 记录权益
    this.historicalData.equityHistory.push({
      timestamp: now,
      value: initialEquity,
    });

    // 记录 PnL（初始为 0）
    this.historicalData.pnlHistory.push({
      timestamp: now,
      value: 0,
    });
  }

  /**
   * 记录权益
   * @param equity - 当前权益
   * @param timestamp - 时间戳（可选）
   */
  recordEquity(equity: number, timestamp?: number): void {
    // 获取时间戳
    const ts = timestamp || Date.now();

    // 检查日期变化
    this.checkDateChange();

    // 更新峰值
    if (equity > this.dailyPeakEquity) {
      this.dailyPeakEquity = equity;
    }

    // 记录权益
    this.historicalData.equityHistory.push({
      timestamp: ts,
      value: equity,
    });

    // 计算并记录 PnL
    const pnl = equity - this.dailyStartEquity;
    this.historicalData.pnlHistory.push({
      timestamp: ts,
      value: pnl,
    });
  }

  /**
   * 记录策略 PnL
   * @param strategy - 策略名称
   * @param pnl - PnL 值
   * @param timestamp - 时间戳（可选）
   */
  recordStrategyPnl(strategy: string, pnl: number, timestamp?: number): void {
    // 获取时间戳
    const ts = timestamp || Date.now();

    // 获取或创建策略历史
    if (!this.historicalData.strategyPnlHistory.has(strategy)) {
      this.historicalData.strategyPnlHistory.set(strategy, []);
    }

    // 记录 PnL
    this.historicalData.strategyPnlHistory.get(strategy)!.push({
      timestamp: ts,
      value: pnl,
    });
  }

  /**
   * 记录保证金率
   * @param exchange - 交易所
   * @param marginRatio - 保证金率
   * @param timestamp - 时间戳（可选）
   */
  recordMarginRatio(exchange: string, marginRatio: number, timestamp?: number): void {
    // 获取时间戳
    const ts = timestamp || Date.now();

    // 获取或创建交易所历史
    if (!this.historicalData.marginHistory.has(exchange)) {
      this.historicalData.marginHistory.set(exchange, []);
    }

    // 记录保证金率
    this.historicalData.marginHistory.get(exchange)!.push({
      timestamp: ts,
      value: marginRatio,
    });
  }

  /**
   * 记录延迟
   * @param exchange - 交易所
   * @param latencyMs - 延迟（毫秒）
   * @param timestamp - 时间戳（可选）
   */
  recordLatency(exchange: string, latencyMs: number, timestamp?: number): void {
    // 获取时间戳
    const ts = timestamp || Date.now();

    // 获取或创建交易所历史
    if (!this.historicalData.latencyHistory.has(exchange)) {
      this.historicalData.latencyHistory.set(exchange, []);
    }

    // 记录延迟
    this.historicalData.latencyHistory.get(exchange)!.push({
      timestamp: ts,
      value: latencyMs,
    });
  }

  /**
   * 记录交易
   * @param trade - 交易记录
   */
  recordTrade(trade: TradeRecord): void {
    this.historicalData.trades.push(trade);
  }

  // ========================================================================
  // 公共方法 - 报告生成
  // ========================================================================

  /**
   * 生成每日绩效报告
   * @param currentEquity - 当前权益
   * @param marginRatios - 各交易所保证金率
   * @param apiStats - API 统计
   */
  generateDailyReport(
    currentEquity: number,
    marginRatios: ExchangeMarginRatio[],
    apiStats: ApiStats
  ): PerformanceReport {
    // 获取今日日期
    const date = this.getCurrentDate();

    // 计算当日 PnL
    const dailyPnl = currentEquity - this.dailyStartEquity;

    // 计算当日收益率
    const dailyReturn = this.dailyStartEquity > 0
      ? dailyPnl / this.dailyStartEquity
      : 0;

    // 计算累计 PnL
    const cumulativePnl = currentEquity - this.cumulativeStartEquity;

    // 计算累计收益率
    const cumulativeReturn = this.cumulativeStartEquity > 0
      ? cumulativePnl / this.cumulativeStartEquity
      : 0;

    // 计算当日最大回撤
    const dailyMaxDrawdown = this.dailyPeakEquity > 0
      ? 1 - currentEquity / this.dailyPeakEquity
      : 0;

    // 计算累计最大回撤
    const cumulativeMaxDrawdown = this.calculateMaxDrawdown(
      this.historicalData.equityHistory
    );

    // 获取今日交易
    const todayTrades = this.getTodayTrades();

    // 计算交易统计
    const tradeStats = this.calculateTradeStats(todayTrades);

    // 计算策略绩效
    const strategyPerformance = this.calculateStrategyPerformance(todayTrades);

    // 计算夏普比率
    const sharpeRatio = this.calculateSharpeRatio(
      this.historicalData.pnlHistory
    );

    // 构建报告
    const report: PerformanceReport = {
      date,
      totalEquity: currentEquity,
      dailyPnl,
      dailyReturn,
      cumulativePnl,
      cumulativeReturn,
      dailyMaxDrawdown,
      cumulativeMaxDrawdown,
      sharpeRatio,
      winRate: tradeStats.winRate,
      tradeCount: tradeStats.tradeCount,
      winCount: tradeStats.winCount,
      lossCount: tradeStats.lossCount,
      avgWin: tradeStats.avgWin,
      avgLoss: tradeStats.avgLoss,
      profitFactor: tradeStats.profitFactor,
      strategyPerformance,
      marginRatios,
      apiStats,
    };

    return report;
  }

  // ========================================================================
  // 公共方法 - 图表生成
  // ========================================================================

  /**
   * 生成 PnL 曲线图 SVG
   * @param title - 图表标题
   * @param timeRange - 时间范围（小时，默认 24）
   */
  generatePnlChartSvg(title: string = '当日 PnL 曲线', timeRange: number = 24): string {
    // 获取时间范围内的数据
    const now = Date.now();
    const startTime = now - timeRange * 60 * 60 * 1000;

    // 过滤数据
    const pnlData = this.historicalData.pnlHistory.filter(
      (p) => p.timestamp >= startTime
    );

    // 如果数据不足，返回空图表
    if (pnlData.length < 2) {
      return this.generateEmptyChart(title, '数据不足');
    }

    // 确定 PnL 颜色（根据最终值）
    const lastPnl = pnlData[pnlData.length - 1]?.value || 0;
    const lineColor = lastPnl >= 0 ? this.config.colors.profit : this.config.colors.loss;

    // 创建时间序列数据
    const seriesData: TimeSeriesData[] = [
      {
        name: 'PnL',
        points: pnlData,
        color: lineColor,
      },
    ];

    // 生成图表
    return this.generateTimeSeriesChart(title, seriesData, '$', true);
  }

  /**
   * 生成策略 PnL 对比图 SVG
   * @param title - 图表标题
   * @param timeRange - 时间范围（小时，默认 24）
   */
  generateStrategyPnlChartSvg(
    title: string = '策略 PnL 对比',
    timeRange: number = 24
  ): string {
    // 获取时间范围内的数据
    const now = Date.now();
    const startTime = now - timeRange * 60 * 60 * 1000;

    // 创建时间序列数据
    const seriesData: TimeSeriesData[] = [];

    // 颜色索引
    let colorIndex = 0;

    // 遍历各策略
    for (const [strategy, points] of this.historicalData.strategyPnlHistory) {
      // 过滤数据
      const filteredPoints = points.filter((p) => p.timestamp >= startTime);

      // 如果有数据，添加到系列
      if (filteredPoints.length > 0) {
        seriesData.push({
          name: strategy,
          points: filteredPoints,
          color: this.config.colors.series[colorIndex % this.config.colors.series.length]!,
        });
        colorIndex++;
      }
    }

    // 如果没有数据，返回空图表
    if (seriesData.length === 0) {
      return this.generateEmptyChart(title, '暂无策略数据');
    }

    // 生成图表
    return this.generateTimeSeriesChart(title, seriesData, '$', true);
  }

  /**
   * 生成保证金率监控图 SVG
   * @param title - 图表标题
   * @param timeRange - 时间范围（小时，默认 24）
   */
  generateMarginChartSvg(
    title: string = '保证金率监控',
    timeRange: number = 24
  ): string {
    // 获取时间范围内的数据
    const now = Date.now();
    const startTime = now - timeRange * 60 * 60 * 1000;

    // 创建时间序列数据
    const seriesData: TimeSeriesData[] = [];

    // 颜色索引
    let colorIndex = 0;

    // 遍历各交易所
    for (const [exchange, points] of this.historicalData.marginHistory) {
      // 过滤数据
      const filteredPoints = points.filter((p) => p.timestamp >= startTime);

      // 如果有数据，添加到系列
      if (filteredPoints.length > 0) {
        seriesData.push({
          name: exchange,
          points: filteredPoints,
          color: this.config.colors.series[colorIndex % this.config.colors.series.length]!,
        });
        colorIndex++;
      }
    }

    // 如果没有数据，返回空图表
    if (seriesData.length === 0) {
      return this.generateEmptyChart(title, '暂无保证金数据');
    }

    // 生成图表（带预警线）
    return this.generateTimeSeriesChartWithThresholds(
      title,
      seriesData,
      '%',
      [
        { value: 0.40, color: this.config.colors.warning, label: '40%' },
        { value: 0.35, color: this.config.colors.danger, label: '35%' },
        { value: 0.30, color: this.config.colors.loss, label: '30%' },
      ]
    );
  }

  /**
   * 生成交易统计柱状图 SVG
   * @param title - 图表标题
   */
  generateTradeStatsChartSvg(title: string = '交易统计'): string {
    // 获取今日交易
    const todayTrades = this.getTodayTrades();

    // 计算统计
    const stats = this.calculateTradeStats(todayTrades);

    // 创建柱状图数据
    const barData: BarChartData[] = [
      {
        label: '盈利',
        value: stats.winCount,
        color: this.config.colors.profit,
      },
      {
        label: '亏损',
        value: stats.lossCount,
        color: this.config.colors.loss,
      },
    ];

    // 生成图表
    return this.generateBarChart(title, barData);
  }

  /**
   * 生成策略占比饼图 SVG
   * @param title - 图表标题
   */
  generateStrategyPieChartSvg(title: string = '策略 PnL 占比'): string {
    // 获取今日交易
    const todayTrades = this.getTodayTrades();

    // 按策略汇总 PnL
    const strategyPnl = new Map<string, number>();

    // 遍历交易
    for (const trade of todayTrades) {
      // 如果有 PnL
      if (trade.pnl !== undefined) {
        const current = strategyPnl.get(trade.strategy) || 0;
        strategyPnl.set(trade.strategy, current + trade.pnl);
      }
    }

    // 创建饼图数据
    const pieData: PieChartData[] = [];

    // 颜色索引
    let colorIndex = 0;

    // 遍历策略
    for (const [strategy, pnl] of strategyPnl) {
      pieData.push({
        label: strategy,
        value: Math.abs(pnl),
        color: this.config.colors.series[colorIndex % this.config.colors.series.length]!,
      });
      colorIndex++;
    }

    // 如果没有数据
    if (pieData.length === 0) {
      return this.generateEmptyChart(title, '暂无交易数据');
    }

    // 生成图表
    return this.generatePieChart(title, pieData);
  }

  // ========================================================================
  // 公共方法 - 重置
  // ========================================================================

  /**
   * 重置每日数据（新的一天）
   * @param currentEquity - 当前权益
   */
  resetDaily(currentEquity: number): void {
    // 更新起始权益
    this.dailyStartEquity = currentEquity;
    this.dailyPeakEquity = currentEquity;

    // 更新当前日期
    this.currentDate = this.getCurrentDate();

    // 清理历史数据（只保留最近 7 天）
    this.cleanupHistoricalData(7 * 24 * 60 * 60 * 1000);
  }

  /**
   * 完全重置
   */
  reset(): void {
    // 重置数据
    this.historicalData = this.createEmptyHistoricalData();
    this.dailyStartEquity = 0;
    this.dailyPeakEquity = 0;
    this.cumulativeStartEquity = 0;
    this.currentDate = this.getCurrentDate();
  }

  // ========================================================================
  // 私有方法 - 图表生成
  // ========================================================================

  /**
   * 生成时间序列图表 SVG
   * @param title - 标题
   * @param seriesData - 数据系列
   * @param unit - 单位
   * @param showZeroLine - 是否显示零线
   */
  private generateTimeSeriesChart(
    title: string,
    seriesData: TimeSeriesData[],
    unit: string,
    showZeroLine: boolean = false
  ): string {
    // 获取图表配置
    const cfg = this.config.chartConfig;

    // 计算绘图区域
    const plotWidth = cfg.width - cfg.padding.left - cfg.padding.right;
    const plotHeight = cfg.height - cfg.padding.top - cfg.padding.bottom;

    // 获取所有数据点的时间和值范围
    let minTime = Infinity;
    let maxTime = -Infinity;
    let minValue = Infinity;
    let maxValue = -Infinity;

    // 遍历所有系列
    for (const series of seriesData) {
      for (const point of series.points) {
        minTime = Math.min(minTime, point.timestamp);
        maxTime = Math.max(maxTime, point.timestamp);
        minValue = Math.min(minValue, point.value);
        maxValue = Math.max(maxValue, point.value);
      }
    }

    // 如果显示零线，确保范围包含零
    if (showZeroLine) {
      minValue = Math.min(minValue, 0);
      maxValue = Math.max(maxValue, 0);
    }

    // 添加边距
    const valueRange = maxValue - minValue;
    minValue -= valueRange * 0.1;
    maxValue += valueRange * 0.1;

    // 开始构建 SVG
    const lines: string[] = [];

    // SVG 头部
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}">`);

    // 背景
    lines.push(`  <rect width="${cfg.width}" height="${cfg.height}" fill="${cfg.backgroundColor}"/>`);

    // 标题
    lines.push(`  <text x="${cfg.width / 2}" y="30" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.titleFontSize}" font-weight="bold">${title}</text>`);

    // 绘制网格
    lines.push(...this.generateGrid(cfg, plotWidth, plotHeight, minValue, maxValue, minTime, maxTime, unit));

    // 绘制零线（如果需要）
    if (showZeroLine && minValue < 0 && maxValue > 0) {
      const zeroY = cfg.padding.top + plotHeight * (maxValue / (maxValue - minValue));
      lines.push(`  <line x1="${cfg.padding.left}" y1="${zeroY}" x2="${cfg.padding.left + plotWidth}" y2="${zeroY}" stroke="${cfg.textColor}" stroke-width="1" stroke-dasharray="4,4"/>`);
    }

    // 绘制数据线
    for (const series of seriesData) {
      if (series.points.length < 2) continue;

      // 构建路径
      const pathPoints: string[] = [];

      for (let i = 0; i < series.points.length; i++) {
        const point = series.points[i]!;

        // 计算坐标
        const x = cfg.padding.left + plotWidth * (point.timestamp - minTime) / (maxTime - minTime);
        const y = cfg.padding.top + plotHeight * (maxValue - point.value) / (maxValue - minValue);

        // 添加到路径
        pathPoints.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }

      // 绘制线条
      lines.push(`  <path d="${pathPoints.join(' ')}" fill="none" stroke="${series.color}" stroke-width="2"/>`);
    }

    // 绘制图例
    lines.push(...this.generateLegend(cfg, seriesData, plotWidth));

    // SVG 尾部
    lines.push('</svg>');

    return lines.join('\n');
  }

  /**
   * 生成带阈值线的时间序列图表
   * @param title - 标题
   * @param seriesData - 数据系列
   * @param unit - 单位
   * @param thresholds - 阈值配置
   */
  private generateTimeSeriesChartWithThresholds(
    title: string,
    seriesData: TimeSeriesData[],
    unit: string,
    thresholds: Array<{ value: number; color: string; label: string }>
  ): string {
    // 获取图表配置
    const cfg = this.config.chartConfig;

    // 计算绘图区域
    const plotWidth = cfg.width - cfg.padding.left - cfg.padding.right;
    const plotHeight = cfg.height - cfg.padding.top - cfg.padding.bottom;

    // 获取数据范围
    let minTime = Infinity;
    let maxTime = -Infinity;
    let minValue = 0;
    let maxValue = 1;

    // 遍历所有系列
    for (const series of seriesData) {
      for (const point of series.points) {
        minTime = Math.min(minTime, point.timestamp);
        maxTime = Math.max(maxTime, point.timestamp);
        minValue = Math.min(minValue, point.value);
        maxValue = Math.max(maxValue, point.value);
      }
    }

    // 保证金率图固定范围 0-1
    minValue = 0;
    maxValue = 1;

    // 开始构建 SVG
    const lines: string[] = [];

    // SVG 头部
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}">`);

    // 背景
    lines.push(`  <rect width="${cfg.width}" height="${cfg.height}" fill="${cfg.backgroundColor}"/>`);

    // 标题
    lines.push(`  <text x="${cfg.width / 2}" y="30" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.titleFontSize}" font-weight="bold">${title}</text>`);

    // 绘制网格
    lines.push(...this.generateGrid(cfg, plotWidth, plotHeight, minValue, maxValue, minTime, maxTime, unit));

    // 绘制阈值线
    for (const threshold of thresholds) {
      const y = cfg.padding.top + plotHeight * (1 - threshold.value);
      lines.push(`  <line x1="${cfg.padding.left}" y1="${y}" x2="${cfg.padding.left + plotWidth}" y2="${y}" stroke="${threshold.color}" stroke-width="1" stroke-dasharray="5,5"/>`);
      lines.push(`  <text x="${cfg.padding.left + plotWidth + 5}" y="${y + 4}" fill="${threshold.color}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${threshold.label}</text>`);
    }

    // 绘制数据线
    for (const series of seriesData) {
      if (series.points.length < 2) continue;

      // 构建路径
      const pathPoints: string[] = [];

      for (let i = 0; i < series.points.length; i++) {
        const point = series.points[i]!;

        // 计算坐标
        const x = cfg.padding.left + plotWidth * (point.timestamp - minTime) / (maxTime - minTime);
        const y = cfg.padding.top + plotHeight * (1 - point.value);

        // 添加到路径
        pathPoints.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
      }

      // 绘制线条
      lines.push(`  <path d="${pathPoints.join(' ')}" fill="none" stroke="${series.color}" stroke-width="2"/>`);
    }

    // 绘制图例
    lines.push(...this.generateLegend(cfg, seriesData, plotWidth));

    // SVG 尾部
    lines.push('</svg>');

    return lines.join('\n');
  }

  /**
   * 生成柱状图 SVG
   * @param title - 标题
   * @param data - 数据
   */
  private generateBarChart(title: string, data: BarChartData[]): string {
    // 获取图表配置
    const cfg = this.config.chartConfig;

    // 计算绘图区域
    const plotWidth = cfg.width - cfg.padding.left - cfg.padding.right;
    const plotHeight = cfg.height - cfg.padding.top - cfg.padding.bottom;

    // 计算最大值
    const maxValue = Math.max(...data.map((d) => d.value), 1);

    // 计算柱宽
    const barWidth = plotWidth / (data.length * 2);
    const gap = barWidth;

    // 开始构建 SVG
    const lines: string[] = [];

    // SVG 头部
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}">`);

    // 背景
    lines.push(`  <rect width="${cfg.width}" height="${cfg.height}" fill="${cfg.backgroundColor}"/>`);

    // 标题
    lines.push(`  <text x="${cfg.width / 2}" y="30" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.titleFontSize}" font-weight="bold">${title}</text>`);

    // 绘制柱子
    for (let i = 0; i < data.length; i++) {
      const item = data[i]!;

      // 计算位置
      const x = cfg.padding.left + gap + i * (barWidth + gap);
      const barHeight = plotHeight * (item.value / maxValue);
      const y = cfg.padding.top + plotHeight - barHeight;

      // 绘制柱子
      lines.push(`  <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${item.color}" rx="4"/>`);

      // 绘制数值
      lines.push(`  <text x="${x + barWidth / 2}" y="${y - 10}" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${item.value}</text>`);

      // 绘制标签
      lines.push(`  <text x="${x + barWidth / 2}" y="${cfg.padding.top + plotHeight + 20}" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${item.label}</text>`);
    }

    // SVG 尾部
    lines.push('</svg>');

    return lines.join('\n');
  }

  /**
   * 生成饼图 SVG
   * @param title - 标题
   * @param data - 数据
   */
  private generatePieChart(title: string, data: PieChartData[]): string {
    // 获取图表配置
    const cfg = this.config.chartConfig;

    // 计算总值
    const total = data.reduce((sum, d) => sum + d.value, 0);

    // 如果总值为 0，返回空图表
    if (total === 0) {
      return this.generateEmptyChart(title, '暂无数据');
    }

    // 饼图参数
    const centerX = cfg.width / 2 - 80;
    const centerY = cfg.height / 2 + 10;
    const radius = Math.min(cfg.width, cfg.height) / 3;

    // 开始构建 SVG
    const lines: string[] = [];

    // SVG 头部
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}">`);

    // 背景
    lines.push(`  <rect width="${cfg.width}" height="${cfg.height}" fill="${cfg.backgroundColor}"/>`);

    // 标题
    lines.push(`  <text x="${cfg.width / 2}" y="30" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.titleFontSize}" font-weight="bold">${title}</text>`);

    // 绘制扇形
    let startAngle = -Math.PI / 2;

    for (const item of data) {
      // 计算角度
      const angle = (item.value / total) * 2 * Math.PI;
      const endAngle = startAngle + angle;

      // 计算路径
      const x1 = centerX + radius * Math.cos(startAngle);
      const y1 = centerY + radius * Math.sin(startAngle);
      const x2 = centerX + radius * Math.cos(endAngle);
      const y2 = centerY + radius * Math.sin(endAngle);

      // 大弧标志
      const largeArc = angle > Math.PI ? 1 : 0;

      // 绘制扇形
      lines.push(`  <path d="M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${item.color}"/>`);

      // 更新起始角度
      startAngle = endAngle;
    }

    // 绘制图例
    const legendX = cfg.width - 150;
    let legendY = cfg.padding.top + 20;

    for (const item of data) {
      // 颜色方块
      lines.push(`  <rect x="${legendX}" y="${legendY - 10}" width="12" height="12" fill="${item.color}" rx="2"/>`);

      // 标签
      const percent = ((item.value / total) * 100).toFixed(1);
      lines.push(`  <text x="${legendX + 20}" y="${legendY}" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${item.label}: ${percent}%</text>`);

      legendY += 20;
    }

    // SVG 尾部
    lines.push('</svg>');

    return lines.join('\n');
  }

  /**
   * 生成空图表 SVG
   * @param title - 标题
   * @param message - 消息
   */
  private generateEmptyChart(title: string, message: string): string {
    // 获取图表配置
    const cfg = this.config.chartConfig;

    // 开始构建 SVG
    const lines: string[] = [];

    // SVG 头部
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.width}" height="${cfg.height}">`);

    // 背景
    lines.push(`  <rect width="${cfg.width}" height="${cfg.height}" fill="${cfg.backgroundColor}"/>`);

    // 标题
    lines.push(`  <text x="${cfg.width / 2}" y="30" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.titleFontSize}" font-weight="bold">${title}</text>`);

    // 消息
    lines.push(`  <text x="${cfg.width / 2}" y="${cfg.height / 2}" text-anchor="middle" fill="${cfg.gridColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${message}</text>`);

    // SVG 尾部
    lines.push('</svg>');

    return lines.join('\n');
  }

  /**
   * 生成网格
   */
  private generateGrid(
    cfg: ChartConfig,
    plotWidth: number,
    plotHeight: number,
    minValue: number,
    maxValue: number,
    minTime: number,
    maxTime: number,
    unit: string
  ): string[] {
    const lines: string[] = [];

    // 横向网格线（5 条）
    for (let i = 0; i <= 4; i++) {
      const y = cfg.padding.top + plotHeight * (i / 4);
      const value = maxValue - (maxValue - minValue) * (i / 4);

      // 网格线
      lines.push(`  <line x1="${cfg.padding.left}" y1="${y}" x2="${cfg.padding.left + plotWidth}" y2="${y}" stroke="${cfg.gridColor}" stroke-width="1"/>`);

      // Y 轴标签
      let valueStr: string;
      if (unit === '%') {
        valueStr = `${(value * 100).toFixed(0)}%`;
      } else {
        valueStr = `${unit}${value.toFixed(0)}`;
      }
      lines.push(`  <text x="${cfg.padding.left - 10}" y="${y + 4}" text-anchor="end" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${valueStr}</text>`);
    }

    // 纵向网格线（6 条）
    for (let i = 0; i <= 5; i++) {
      const x = cfg.padding.left + plotWidth * (i / 5);
      const time = minTime + (maxTime - minTime) * (i / 5);

      // 网格线
      lines.push(`  <line x1="${x}" y1="${cfg.padding.top}" x2="${x}" y2="${cfg.padding.top + plotHeight}" stroke="${cfg.gridColor}" stroke-width="1"/>`);

      // X 轴标签
      const date = new Date(time);
      const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      lines.push(`  <text x="${x}" y="${cfg.padding.top + plotHeight + 20}" text-anchor="middle" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${timeStr}</text>`);
    }

    return lines;
  }

  /**
   * 生成图例
   */
  private generateLegend(
    cfg: ChartConfig,
    seriesData: TimeSeriesData[],
    _plotWidth: number
  ): string[] {
    const lines: string[] = [];

    // 图例位置
    let legendX = cfg.padding.left;
    const legendY = cfg.height - 15;

    // 遍历系列
    for (const series of seriesData) {
      // 颜色方块
      lines.push(`  <rect x="${legendX}" y="${legendY - 10}" width="12" height="12" fill="${series.color}" rx="2"/>`);

      // 标签
      lines.push(`  <text x="${legendX + 16}" y="${legendY}" fill="${cfg.textColor}" font-family="${cfg.fontFamily}" font-size="${cfg.labelFontSize}">${series.name}</text>`);

      // 移动位置
      legendX += series.name.length * 8 + 40;
    }

    return lines;
  }

  // ========================================================================
  // 私有方法 - 计算统计
  // ========================================================================

  /**
   * 计算最大回撤
   * @param equityHistory - 权益历史
   */
  private calculateMaxDrawdown(equityHistory: TimeSeriesPoint[]): number {
    // 如果数据不足，返回 0
    if (equityHistory.length < 2) {
      return 0;
    }

    // 计算最大回撤
    let maxDrawdown = 0;
    let peak = equityHistory[0]!.value;

    // 遍历权益历史
    for (const point of equityHistory) {
      // 更新峰值
      if (point.value > peak) {
        peak = point.value;
      }

      // 计算回撤
      const drawdown = (peak - point.value) / peak;

      // 更新最大回撤
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * 计算夏普比率
   * @param pnlHistory - PnL 历史
   */
  private calculateSharpeRatio(pnlHistory: TimeSeriesPoint[]): number {
    // 如果数据不足，返回 0
    if (pnlHistory.length < 2) {
      return 0;
    }

    // 计算日收益率
    const returns: number[] = [];

    for (let i = 1; i < pnlHistory.length; i++) {
      const prev = pnlHistory[i - 1]!.value;
      const curr = pnlHistory[i]!.value;

      // 计算收益率
      if (prev !== 0) {
        returns.push((curr - prev) / Math.abs(prev));
      }
    }

    // 如果收益率数据不足，返回 0
    if (returns.length < 2) {
      return 0;
    }

    // 计算平均收益率
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

    // 计算标准差
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // 如果标准差为 0，返回 0
    if (stdDev === 0) {
      return 0;
    }

    // 计算夏普比率（假设无风险利率为 0，年化因子 365）
    const sharpeRatio = (avgReturn / stdDev) * Math.sqrt(365);

    return sharpeRatio;
  }

  /**
   * 计算交易统计
   * @param trades - 交易记录
   */
  private calculateTradeStats(trades: TradeRecord[]): {
    tradeCount: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
  } {
    // 过滤有 PnL 的交易
    const closedTrades = trades.filter((t) => t.pnl !== undefined);

    // 如果没有已平仓交易
    if (closedTrades.length === 0) {
      return {
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
      };
    }

    // 分离盈亏交易
    const winTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
    const lossTrades = closedTrades.filter((t) => (t.pnl || 0) <= 0);

    // 计算统计
    const winCount = winTrades.length;
    const lossCount = lossTrades.length;
    const tradeCount = closedTrades.length;

    // 计算胜率
    const winRate = tradeCount > 0 ? winCount / tradeCount : 0;

    // 计算平均盈亏
    const totalWin = winTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLoss = Math.abs(lossTrades.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const avgWin = winCount > 0 ? totalWin / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLoss / lossCount : 0;

    // 计算盈亏比
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0;

    return {
      tradeCount,
      winCount,
      lossCount,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
    };
  }

  /**
   * 计算策略绩效
   * @param trades - 交易记录
   */
  private calculateStrategyPerformance(trades: TradeRecord[]): StrategyPerformance[] {
    // 按策略分组
    const strategyMap = new Map<string, TradeRecord[]>();

    // 遍历交易
    for (const trade of trades) {
      if (!strategyMap.has(trade.strategy)) {
        strategyMap.set(trade.strategy, []);
      }
      strategyMap.get(trade.strategy)!.push(trade);
    }

    // 计算各策略绩效
    const performance: StrategyPerformance[] = [];

    // 遍历策略
    for (const [strategy, strategyTrades] of strategyMap) {
      // 过滤有 PnL 的交易
      const closedTrades = strategyTrades.filter((t) => t.pnl !== undefined);

      // 计算 PnL
      const dailyPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      // 计算胜率
      const winTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
      const winRate = closedTrades.length > 0 ? winTrades.length / closedTrades.length : 0;

      // 添加到结果
      performance.push({
        name: strategy,
        dailyPnl,
        dailyReturn: 0, // 需要知道策略配资才能计算
        tradeCount: closedTrades.length,
        winRate,
      });
    }

    return performance;
  }

  /**
   * 获取今日交易
   */
  private getTodayTrades(): TradeRecord[] {
    // 获取今日开始时间戳
    const todayStart = this.getTodayStartTimestamp();

    // 过滤今日交易
    return this.historicalData.trades.filter((t) => t.timestamp >= todayStart);
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 创建空的历史数据
   */
  private createEmptyHistoricalData(): HistoricalData {
    return {
      pnlHistory: [],
      equityHistory: [],
      strategyPnlHistory: new Map(),
      marginHistory: new Map(),
      latencyHistory: new Map(),
      trades: [],
    };
  }

  /**
   * 获取当前日期字符串
   */
  private getCurrentDate(): string {
    // 创建日期对象
    const now = new Date();

    // 调整时区
    const localDate = new Date(
      now.getTime() + this.config.timezoneOffset * 60 * 60 * 1000
    );

    // 格式化
    const year = localDate.getUTCFullYear();
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localDate.getUTCDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * 获取今日开始时间戳
   */
  private getTodayStartTimestamp(): number {
    // 创建日期对象
    const now = new Date();

    // 调整时区
    const localDate = new Date(
      now.getTime() + this.config.timezoneOffset * 60 * 60 * 1000
    );

    // 设置为 0 点
    localDate.setUTCHours(0, 0, 0, 0);

    // 返回时间戳
    return localDate.getTime() - this.config.timezoneOffset * 60 * 60 * 1000;
  }

  /**
   * 检查日期变化
   */
  private checkDateChange(): void {
    // 获取当前日期
    const today = this.getCurrentDate();

    // 如果日期变化
    if (today !== this.currentDate) {
      // 获取最后一个权益值
      const lastEquity = this.historicalData.equityHistory.length > 0
        ? this.historicalData.equityHistory[this.historicalData.equityHistory.length - 1]!.value
        : this.dailyStartEquity;

      // 重置每日数据
      this.resetDaily(lastEquity);
    }
  }

  /**
   * 清理历史数据
   * @param retentionMs - 保留时间（毫秒）
   */
  private cleanupHistoricalData(retentionMs: number): void {
    // 计算截止时间
    const cutoff = Date.now() - retentionMs;

    // 清理 PnL 历史
    this.historicalData.pnlHistory = this.historicalData.pnlHistory.filter(
      (p) => p.timestamp >= cutoff
    );

    // 清理权益历史
    this.historicalData.equityHistory = this.historicalData.equityHistory.filter(
      (p) => p.timestamp >= cutoff
    );

    // 清理策略 PnL 历史
    for (const [strategy, points] of this.historicalData.strategyPnlHistory) {
      const filtered = points.filter((p) => p.timestamp >= cutoff);
      if (filtered.length > 0) {
        this.historicalData.strategyPnlHistory.set(strategy, filtered);
      } else {
        this.historicalData.strategyPnlHistory.delete(strategy);
      }
    }

    // 清理保证金率历史
    for (const [exchange, points] of this.historicalData.marginHistory) {
      const filtered = points.filter((p) => p.timestamp >= cutoff);
      if (filtered.length > 0) {
        this.historicalData.marginHistory.set(exchange, filtered);
      } else {
        this.historicalData.marginHistory.delete(exchange);
      }
    }

    // 清理延迟历史
    for (const [exchange, points] of this.historicalData.latencyHistory) {
      const filtered = points.filter((p) => p.timestamp >= cutoff);
      if (filtered.length > 0) {
        this.historicalData.latencyHistory.set(exchange, filtered);
      } else {
        this.historicalData.latencyHistory.delete(exchange);
      }
    }

    // 清理交易记录
    this.historicalData.trades = this.historicalData.trades.filter(
      (t) => t.timestamp >= cutoff
    );
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建每日报告生成器
 * @param config - 配置
 */
export function createDailyReportGenerator(
  config?: Partial<ReportGeneratorConfig>
): DailyReportGenerator {
  return new DailyReportGenerator(config);
}

// 导出默认配置
export { DEFAULT_REPORT_CONFIG, DEFAULT_CHART_CONFIG };
