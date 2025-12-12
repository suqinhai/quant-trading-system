// ============================================================================
// Grafana 仪表盘配置生成器
// 自动生成 PnL 曲线、保证金率预警、延迟监控、API 错误率等仪表盘
// ============================================================================

// ============================================================================
// 类型定义
// ============================================================================

// Grafana 面板类型
export type GrafanaPanelType =
  | 'timeseries'    // 时间序列图
  | 'gauge'         // 仪表盘
  | 'stat'          // 统计值
  | 'table'         // 表格
  | 'heatmap'       // 热力图
  | 'alertlist'     // 告警列表
  | 'text';         // 文本

// Grafana 数据源类型
export type GrafanaDataSource = 'prometheus' | 'loki' | 'influxdb';

// 颜色模式
export type ColorMode = 'palette-classic' | 'continuous-GrYlRd' | 'continuous-RdYlGr' | 'fixed' | 'thresholds';

// 阈值配置
export interface ThresholdConfig {
  // 颜色
  color: string;
  // 阈值
  value: number | null;
}

// 面板目标（查询）
export interface PanelTarget {
  // 数据源
  datasource?: string | { type: string; uid: string };
  // PromQL 表达式
  expr: string;
  // 图例格式
  legendFormat?: string;
  // 刷新间隔
  interval?: string;
  // 引用 ID
  refId: string;
}

// 字段配置
export interface FieldConfig {
  // 默认配置
  defaults: {
    // 颜色配置
    color?: {
      mode: ColorMode;
      fixedColor?: string;
    };
    // 自定义配置
    custom?: Record<string, unknown>;
    // 映射配置
    mappings?: unknown[];
    // 阈值配置
    thresholds?: {
      mode: 'absolute' | 'percentage';
      steps: ThresholdConfig[];
    };
    // 单位
    unit?: string;
    // 最小值
    min?: number;
    // 最大值
    max?: number;
    // 小数位数
    decimals?: number;
  };
  // 覆盖配置
  overrides?: unknown[];
}

// 面板配置
export interface GrafanaPanel {
  // 面板 ID
  id: number;
  // 面板类型
  type: GrafanaPanelType;
  // 标题
  title: string;
  // 描述
  description?: string;
  // 网格位置
  gridPos: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  // 数据源
  datasource?: {
    type: string;
    uid: string;
  };
  // 查询目标
  targets?: PanelTarget[];
  // 字段配置
  fieldConfig?: FieldConfig;
  // 面板选项
  options?: Record<string, unknown>;
  // 透明背景
  transparent?: boolean;
}

// 仪表盘行
export interface DashboardRow {
  // 行标题
  title: string;
  // 是否折叠
  collapsed: boolean;
  // 面板列表
  panels: GrafanaPanel[];
}

// 仪表盘配置
export interface GrafanaDashboard {
  // 仪表盘 ID（null 表示新建）
  id: null;
  // 唯一标识符
  uid: string;
  // 标题
  title: string;
  // 描述
  description?: string;
  // 标签
  tags: string[];
  // 时区
  timezone: string;
  // 是否可编辑
  editable: boolean;
  // 图形工具提示
  graphTooltip: number;
  // 刷新间隔
  refresh: string;
  // 模式版本
  schemaVersion: number;
  // 版本
  version: number;
  // 面板列表
  panels: GrafanaPanel[];
  // 时间范围
  time: {
    from: string;
    to: string;
  };
  // 时间选项
  timepicker: {
    refresh_intervals: string[];
  };
  // 注解
  annotations?: {
    list: unknown[];
  };
  // 模板变量
  templating?: {
    list: unknown[];
  };
}

// 仪表盘生成器配置
export interface DashboardGeneratorConfig {
  // Prometheus 数据源 UID
  prometheusUid: string;
  // 指标前缀
  metricPrefix: string;
  // 刷新间隔
  refreshInterval: string;
  // 保证金预警阈值
  marginThresholds: number[];
  // 延迟预警阈值（毫秒）
  latencyThreshold: number;
  // 错误率预警阈值
  errorRateThreshold: number;
}

// 默认配置
const DEFAULT_GENERATOR_CONFIG: DashboardGeneratorConfig = {
  // Prometheus 数据源 UID
  prometheusUid: 'prometheus',
  // 指标前缀
  metricPrefix: 'quant_',
  // 刷新间隔 5 秒
  refreshInterval: '5s',
  // 保证金预警阈值：40%, 35%, 30%
  marginThresholds: [0.40, 0.35, 0.30],
  // 延迟预警阈值 500ms
  latencyThreshold: 500,
  // 错误率预警阈值 5%
  errorRateThreshold: 0.05,
};

// ============================================================================
// Grafana 仪表盘生成器类
// ============================================================================

/**
 * Grafana 仪表盘生成器
 * 自动生成量化交易监控仪表盘
 */
export class GrafanaDashboardGenerator {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: DashboardGeneratorConfig;

  // 面板 ID 计数器
  private panelIdCounter: number = 1;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<DashboardGeneratorConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_GENERATOR_CONFIG, ...config };
  }

  // ========================================================================
  // 公共方法 - 生成完整仪表盘
  // ========================================================================

  /**
   * 生成主监控仪表盘
   */
  generateMainDashboard(): GrafanaDashboard {
    // 重置面板 ID 计数器
    this.panelIdCounter = 1;

    // 创建仪表盘
    const dashboard: GrafanaDashboard = {
      // 新建仪表盘
      id: null,
      // 唯一标识符
      uid: 'quant-main-dashboard',
      // 标题
      title: '量化交易主监控',
      // 描述
      description: '实时监控 PnL、保证金率、延迟、API 错误率等关键指标',
      // 标签
      tags: ['quant', 'trading', 'monitoring'],
      // 时区
      timezone: 'browser',
      // 可编辑
      editable: true,
      // 共享十字准线
      graphTooltip: 1,
      // 刷新间隔
      refresh: this.config.refreshInterval,
      // 模式版本
      schemaVersion: 39,
      // 版本
      version: 1,
      // 面板列表
      panels: [],
      // 时间范围：最近 6 小时
      time: {
        from: 'now-6h',
        to: 'now',
      },
      // 时间选择器
      timepicker: {
        refresh_intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
      },
      // 注解
      annotations: {
        list: [],
      },
      // 模板变量
      templating: {
        list: this.generateTemplateVariables(),
      },
    };

    // 添加概览行
    dashboard.panels.push(...this.generateOverviewRow());

    // 添加 PnL 行
    dashboard.panels.push(...this.generatePnlRow());

    // 添加保证金行
    dashboard.panels.push(...this.generateMarginRow());

    // 添加延迟监控行
    dashboard.panels.push(...this.generateLatencyRow());

    // 添加 API 错误行
    dashboard.panels.push(...this.generateApiErrorRow());

    // 添加策略行
    dashboard.panels.push(...this.generateStrategyRow());

    // 返回仪表盘
    return dashboard;
  }

  /**
   * 生成 PnL 详情仪表盘
   */
  generatePnlDashboard(): GrafanaDashboard {
    // 重置面板 ID 计数器
    this.panelIdCounter = 1;

    // 创建仪表盘
    const dashboard: GrafanaDashboard = {
      id: null,
      uid: 'quant-pnl-dashboard',
      title: '盈亏分析仪表盘',
      description: '按策略、按币种的详细 PnL 分析',
      tags: ['quant', 'pnl', 'analysis'],
      timezone: 'browser',
      editable: true,
      graphTooltip: 1,
      refresh: this.config.refreshInterval,
      schemaVersion: 39,
      version: 1,
      panels: [],
      time: {
        from: 'now-24h',
        to: 'now',
      },
      timepicker: {
        refresh_intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h'],
      },
      templating: {
        list: this.generateTemplateVariables(),
      },
    };

    // 添加 PnL 总览
    dashboard.panels.push(...this.generatePnlDetailPanels());

    return dashboard;
  }

  // ========================================================================
  // 私有方法 - 模板变量
  // ========================================================================

  /**
   * 生成模板变量
   */
  private generateTemplateVariables(): unknown[] {
    return [
      // 交易所变量
      {
        // 变量名
        name: 'exchange',
        // 类型：查询
        type: 'query',
        // 数据源
        datasource: {
          type: 'prometheus',
          uid: this.config.prometheusUid,
        },
        // 查询表达式
        query: `label_values(${this.config.metricPrefix}margin_ratio, exchange)`,
        // 刷新：时间范围变化时
        refresh: 2,
        // 多选
        multi: true,
        // 包含全部选项
        includeAll: true,
        // 全部选项值
        allValue: '.*',
        // 标签
        label: '交易所',
      },
      // 策略变量
      {
        name: 'strategy',
        type: 'query',
        datasource: {
          type: 'prometheus',
          uid: this.config.prometheusUid,
        },
        query: `label_values(${this.config.metricPrefix}pnl_total, strategy)`,
        refresh: 2,
        multi: true,
        includeAll: true,
        allValue: '.*',
        label: '策略',
      },
      // 交易对变量
      {
        name: 'symbol',
        type: 'query',
        datasource: {
          type: 'prometheus',
          uid: this.config.prometheusUid,
        },
        query: `label_values(${this.config.metricPrefix}pnl_total, symbol)`,
        refresh: 2,
        multi: true,
        includeAll: true,
        allValue: '.*',
        label: '交易对',
      },
    ];
  }

  // ========================================================================
  // 私有方法 - 概览行
  // ========================================================================

  /**
   * 生成概览行面板
   */
  private generateOverviewRow(): GrafanaPanel[] {
    // 当前 Y 位置
    let y = 0;

    return [
      // 总 PnL 统计
      this.createStatPanel({
        title: '总盈亏',
        x: 0,
        y,
        w: 4,
        h: 4,
        expr: `sum(${this.config.metricPrefix}pnl_total)`,
        unit: 'currencyUSD',
        thresholds: [
          { color: 'red', value: null },
          { color: 'yellow', value: 0 },
          { color: 'green', value: 1000 },
        ],
      }),

      // 今日 PnL
      this.createStatPanel({
        title: '今日盈亏',
        x: 4,
        y,
        w: 4,
        h: 4,
        expr: `sum(increase(${this.config.metricPrefix}pnl_realized[24h]))`,
        unit: 'currencyUSD',
        thresholds: [
          { color: 'red', value: null },
          { color: 'yellow', value: 0 },
          { color: 'green', value: 100 },
        ],
      }),

      // 平均保证金率
      this.createGaugePanel({
        title: '平均保证金率',
        x: 8,
        y,
        w: 4,
        h: 4,
        expr: `avg(${this.config.metricPrefix}margin_ratio{exchange=~"$exchange"})`,
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: [
          { color: 'red', value: null },
          { color: 'orange', value: 0.30 },
          { color: 'yellow', value: 0.35 },
          { color: 'green', value: 0.40 },
        ],
      }),

      // 平均延迟
      this.createStatPanel({
        title: '平均 API 延迟',
        x: 12,
        y,
        w: 4,
        h: 4,
        expr: `avg(${this.config.metricPrefix}api_latency_current_ms{exchange=~"$exchange"})`,
        unit: 'ms',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 100 },
          { color: 'orange', value: 300 },
          { color: 'red', value: 500 },
        ],
      }),

      // API 错误率
      this.createGaugePanel({
        title: 'API 错误率',
        x: 16,
        y,
        w: 4,
        h: 4,
        expr: `avg(${this.config.metricPrefix}api_error_rate{exchange=~"$exchange"})`,
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 0.01 },
          { color: 'orange', value: 0.05 },
          { color: 'red', value: 0.10 },
        ],
      }),

      // 运行时间
      this.createStatPanel({
        title: '系统运行时间',
        x: 20,
        y,
        w: 4,
        h: 4,
        expr: `${this.config.metricPrefix}process_uptime_seconds`,
        unit: 's',
        thresholds: [
          { color: 'green', value: null },
        ],
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - PnL 行
  // ========================================================================

  /**
   * 生成 PnL 行面板
   */
  private generatePnlRow(): GrafanaPanel[] {
    // 当前 Y 位置
    const y = 4;

    return [
      // PnL 曲线（按策略）
      this.createTimeseriesPanel({
        title: 'PnL 曲线（按策略）',
        x: 0,
        y,
        w: 12,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}pnl_total{strategy=~"$strategy"}`,
            legendFormat: '{{strategy}}',
            refId: 'A',
          },
        ],
        unit: 'currencyUSD',
        description: '各策略的总盈亏曲线',
      }),

      // PnL 曲线（按币种）
      this.createTimeseriesPanel({
        title: 'PnL 曲线（按币种）',
        x: 12,
        y,
        w: 12,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}pnl_total{symbol=~"$symbol"}`,
            legendFormat: '{{symbol}}',
            refId: 'A',
          },
        ],
        unit: 'currencyUSD',
        description: '各交易对的总盈亏曲线',
      }),

      // 已实现 vs 未实现 PnL
      this.createTimeseriesPanel({
        title: '已实现 vs 未实现盈亏',
        x: 0,
        y: y + 8,
        w: 12,
        h: 6,
        targets: [
          {
            expr: `sum(${this.config.metricPrefix}pnl_realized{strategy=~"$strategy"})`,
            legendFormat: '已实现盈亏',
            refId: 'A',
          },
          {
            expr: `sum(${this.config.metricPrefix}pnl_unrealized{strategy=~"$strategy"})`,
            legendFormat: '未实现盈亏',
            refId: 'B',
          },
        ],
        unit: 'currencyUSD',
      }),

      // PnL 分布饼图（使用统计面板模拟）
      this.createStatPanel({
        title: '策略 PnL 占比',
        x: 12,
        y: y + 8,
        w: 12,
        h: 6,
        expr: `${this.config.metricPrefix}pnl_total{strategy=~"$strategy"}`,
        unit: 'currencyUSD',
        legendFormat: '{{strategy}}',
      }),
    ];
  }

  /**
   * 生成 PnL 详情面板
   */
  private generatePnlDetailPanels(): GrafanaPanel[] {
    let y = 0;

    return [
      // 累计 PnL 曲线
      this.createTimeseriesPanel({
        title: '累计盈亏曲线',
        x: 0,
        y,
        w: 24,
        h: 8,
        targets: [
          {
            expr: `sum(${this.config.metricPrefix}pnl_total)`,
            legendFormat: '总盈亏',
            refId: 'A',
          },
          {
            expr: `sum(${this.config.metricPrefix}pnl_realized)`,
            legendFormat: '已实现',
            refId: 'B',
          },
          {
            expr: `sum(${this.config.metricPrefix}pnl_unrealized)`,
            legendFormat: '未实现',
            refId: 'C',
          },
        ],
        unit: 'currencyUSD',
      }),

      // 按策略 PnL
      this.createTimeseriesPanel({
        title: '按策略盈亏明细',
        x: 0,
        y: y + 8,
        w: 12,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}pnl_total{strategy=~"$strategy"}`,
            legendFormat: '{{strategy}}',
            refId: 'A',
          },
        ],
        unit: 'currencyUSD',
      }),

      // 按币种 PnL
      this.createTimeseriesPanel({
        title: '按币种盈亏明细',
        x: 12,
        y: y + 8,
        w: 12,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}pnl_total{symbol=~"$symbol"}`,
            legendFormat: '{{symbol}}',
            refId: 'A',
          },
        ],
        unit: 'currencyUSD',
      }),

      // PnL 表格
      this.createTablePanel({
        title: 'PnL 明细表',
        x: 0,
        y: y + 16,
        w: 24,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}pnl_total{strategy=~"$strategy", symbol=~"$symbol"}`,
            legendFormat: '',
            refId: 'A',
          },
        ],
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - 保证金行
  // ========================================================================

  /**
   * 生成保证金行面板
   */
  private generateMarginRow(): GrafanaPanel[] {
    // 当前 Y 位置
    const y = 18;

    // 生成阈值线表达式
    const thresholdLines = this.config.marginThresholds.map((t, i) => ({
      expr: `vector(${t})`,
      legendFormat: `预警线 ${(t * 100).toFixed(0)}%`,
      refId: String.fromCharCode(66 + i), // B, C, D...
    }));

    return [
      // 保证金率曲线（带预警线）
      this.createTimeseriesPanel({
        title: '保证金率监控（带预警线）',
        x: 0,
        y,
        w: 16,
        h: 8,
        targets: [
          {
            expr: `${this.config.metricPrefix}margin_ratio{exchange=~"$exchange"}`,
            legendFormat: '{{exchange}}',
            refId: 'A',
          },
          ...thresholdLines,
        ],
        unit: 'percentunit',
        description: '实时保证金率，红线为 30%、橙线为 35%、黄线为 40% 预警',
        thresholds: [
          { color: 'red', value: null },
          { color: 'orange', value: 0.30 },
          { color: 'yellow', value: 0.35 },
          { color: 'green', value: 0.40 },
        ],
      }),

      // 保证金预警状态
      this.createStatPanel({
        title: '预警状态',
        x: 16,
        y,
        w: 4,
        h: 4,
        expr: `max(${this.config.metricPrefix}margin_alert_status{exchange=~"$exchange"})`,
        unit: 'none',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 1 },
          { color: 'orange', value: 2 },
          { color: 'red', value: 3 },
        ],
        mappings: [
          { type: 'value', options: { '0': { text: '正常', color: 'green' } } },
          { type: 'value', options: { '1': { text: '40% 预警', color: 'yellow' } } },
          { type: 'value', options: { '2': { text: '35% 预警', color: 'orange' } } },
          { type: 'value', options: { '3': { text: '30% 预警', color: 'red' } } },
        ],
      }),

      // 各交易所保证金率
      this.createGaugePanel({
        title: '各交易所保证金率',
        x: 20,
        y,
        w: 4,
        h: 4,
        expr: `${this.config.metricPrefix}margin_ratio{exchange=~"$exchange"}`,
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: [
          { color: 'red', value: null },
          { color: 'orange', value: 0.30 },
          { color: 'yellow', value: 0.35 },
          { color: 'green', value: 0.40 },
        ],
        legendFormat: '{{exchange}}',
      }),

      // 总权益
      this.createTimeseriesPanel({
        title: '总权益趋势',
        x: 16,
        y: y + 4,
        w: 8,
        h: 4,
        targets: [
          {
            expr: `${this.config.metricPrefix}equity_total{exchange=~"$exchange"}`,
            legendFormat: '{{exchange}}',
            refId: 'A',
          },
        ],
        unit: 'currencyUSD',
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - 延迟监控行
  // ========================================================================

  /**
   * 生成延迟监控行面板
   */
  private generateLatencyRow(): GrafanaPanel[] {
    // 当前 Y 位置
    const y = 26;

    return [
      // API 延迟趋势
      this.createTimeseriesPanel({
        title: 'API 延迟趋势',
        x: 0,
        y,
        w: 12,
        h: 6,
        targets: [
          {
            expr: `${this.config.metricPrefix}api_latency_current_ms{exchange=~"$exchange"}`,
            legendFormat: '{{exchange}} - {{operation}}',
            refId: 'A',
          },
        ],
        unit: 'ms',
        description: '各交易所 API 延迟监控',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 100 },
          { color: 'red', value: 500 },
        ],
      }),

      // 延迟直方图（P50, P95, P99）
      this.createTimeseriesPanel({
        title: '延迟百分位数',
        x: 12,
        y,
        w: 12,
        h: 6,
        targets: [
          {
            expr: `histogram_quantile(0.50, sum(rate(${this.config.metricPrefix}api_latency_seconds_bucket{exchange=~"$exchange"}[5m])) by (le, exchange))`,
            legendFormat: '{{exchange}} P50',
            refId: 'A',
          },
          {
            expr: `histogram_quantile(0.95, sum(rate(${this.config.metricPrefix}api_latency_seconds_bucket{exchange=~"$exchange"}[5m])) by (le, exchange))`,
            legendFormat: '{{exchange}} P95',
            refId: 'B',
          },
          {
            expr: `histogram_quantile(0.99, sum(rate(${this.config.metricPrefix}api_latency_seconds_bucket{exchange=~"$exchange"}[5m])) by (le, exchange))`,
            legendFormat: '{{exchange}} P99',
            refId: 'C',
          },
        ],
        unit: 's',
      }),

      // 各交易所当前延迟
      this.createStatPanel({
        title: 'Binance 延迟',
        x: 0,
        y: y + 6,
        w: 4,
        h: 3,
        expr: `${this.config.metricPrefix}api_latency_current_ms{exchange="binance", operation="rest"}`,
        unit: 'ms',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 100 },
          { color: 'red', value: 500 },
        ],
      }),

      this.createStatPanel({
        title: 'Bybit 延迟',
        x: 4,
        y: y + 6,
        w: 4,
        h: 3,
        expr: `${this.config.metricPrefix}api_latency_current_ms{exchange="bybit", operation="rest"}`,
        unit: 'ms',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 100 },
          { color: 'red', value: 500 },
        ],
      }),

      this.createStatPanel({
        title: 'OKX 延迟',
        x: 8,
        y: y + 6,
        w: 4,
        h: 3,
        expr: `${this.config.metricPrefix}api_latency_current_ms{exchange="okx", operation="rest"}`,
        unit: 'ms',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 100 },
          { color: 'red', value: 500 },
        ],
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - API 错误行
  // ========================================================================

  /**
   * 生成 API 错误行面板
   */
  private generateApiErrorRow(): GrafanaPanel[] {
    // 当前 Y 位置
    const y = 35;

    return [
      // 错误率趋势
      this.createTimeseriesPanel({
        title: 'API 错误率趋势',
        x: 0,
        y,
        w: 12,
        h: 6,
        targets: [
          {
            expr: `${this.config.metricPrefix}api_error_rate{exchange=~"$exchange"}`,
            legendFormat: '{{exchange}}',
            refId: 'A',
          },
        ],
        unit: 'percentunit',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 0.01 },
          { color: 'red', value: 0.05 },
        ],
      }),

      // 错误计数
      this.createTimeseriesPanel({
        title: 'API 错误计数',
        x: 12,
        y,
        w: 12,
        h: 6,
        targets: [
          {
            expr: `increase(${this.config.metricPrefix}api_errors_total{exchange=~"$exchange"}[5m])`,
            legendFormat: '{{exchange}} - {{error_type}}',
            refId: 'A',
          },
        ],
        unit: 'short',
      }),

      // 请求成功率
      this.createGaugePanel({
        title: '请求成功率',
        x: 0,
        y: y + 6,
        w: 6,
        h: 4,
        expr: `1 - avg(${this.config.metricPrefix}api_error_rate{exchange=~"$exchange"})`,
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: [
          { color: 'red', value: null },
          { color: 'yellow', value: 0.95 },
          { color: 'green', value: 0.99 },
        ],
      }),

      // 错误类型分布
      this.createStatPanel({
        title: '总错误数',
        x: 6,
        y: y + 6,
        w: 6,
        h: 4,
        expr: `sum(increase(${this.config.metricPrefix}api_errors_total{exchange=~"$exchange"}[24h]))`,
        unit: 'short',
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 10 },
          { color: 'red', value: 50 },
        ],
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - 策略行
  // ========================================================================

  /**
   * 生成策略行面板
   */
  private generateStrategyRow(): GrafanaPanel[] {
    // 当前 Y 位置
    const y = 45;

    return [
      // 策略运行状态
      this.createStatPanel({
        title: '策略运行状态',
        x: 0,
        y,
        w: 6,
        h: 4,
        expr: `${this.config.metricPrefix}strategy_running{strategy=~"$strategy"}`,
        unit: 'none',
        legendFormat: '{{strategy}}',
        thresholds: [
          { color: 'red', value: null },
          { color: 'green', value: 1 },
        ],
        mappings: [
          { type: 'value', options: { '0': { text: '停止', color: 'red' } } },
          { type: 'value', options: { '1': { text: '运行中', color: 'green' } } },
        ],
      }),

      // 夏普比率
      this.createGaugePanel({
        title: '夏普比率',
        x: 6,
        y,
        w: 6,
        h: 4,
        expr: `${this.config.metricPrefix}strategy_sharpe_ratio{strategy=~"$strategy"}`,
        unit: 'none',
        min: -2,
        max: 10,
        thresholds: [
          { color: 'red', value: null },
          { color: 'yellow', value: 1 },
          { color: 'green', value: 2 },
          { color: 'dark-green', value: 4 },
        ],
        legendFormat: '{{strategy}}',
      }),

      // 最大回撤
      this.createGaugePanel({
        title: '最大回撤',
        x: 12,
        y,
        w: 6,
        h: 4,
        expr: `${this.config.metricPrefix}strategy_max_drawdown{strategy=~"$strategy"}`,
        unit: 'percentunit',
        min: 0,
        max: 0.5,
        thresholds: [
          { color: 'green', value: null },
          { color: 'yellow', value: 0.05 },
          { color: 'orange', value: 0.08 },
          { color: 'red', value: 0.15 },
        ],
        legendFormat: '{{strategy}}',
      }),

      // 胜率
      this.createGaugePanel({
        title: '胜率',
        x: 18,
        y,
        w: 6,
        h: 4,
        expr: `${this.config.metricPrefix}strategy_win_rate{strategy=~"$strategy"}`,
        unit: 'percentunit',
        min: 0,
        max: 1,
        thresholds: [
          { color: 'red', value: null },
          { color: 'yellow', value: 0.4 },
          { color: 'green', value: 0.5 },
          { color: 'dark-green', value: 0.6 },
        ],
        legendFormat: '{{strategy}}',
      }),
    ];
  }

  // ========================================================================
  // 私有方法 - 面板创建辅助
  // ========================================================================

  /**
   * 创建时间序列面板
   */
  private createTimeseriesPanel(options: {
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    targets: Array<{ expr: string; legendFormat: string; refId: string }>;
    unit: string;
    description?: string;
    thresholds?: ThresholdConfig[];
  }): GrafanaPanel {
    // 生成面板 ID
    const id = this.panelIdCounter++;

    return {
      id,
      type: 'timeseries',
      title: options.title,
      description: options.description,
      gridPos: {
        x: options.x,
        y: options.y,
        w: options.w,
        h: options.h,
      },
      datasource: {
        type: 'prometheus',
        uid: this.config.prometheusUid,
      },
      targets: options.targets.map((t) => ({
        datasource: {
          type: 'prometheus',
          uid: this.config.prometheusUid,
        },
        expr: t.expr,
        legendFormat: t.legendFormat,
        refId: t.refId,
      })),
      fieldConfig: {
        defaults: {
          color: {
            mode: 'palette-classic',
          },
          custom: {
            axisBorderShow: false,
            axisCenteredZero: false,
            axisColorMode: 'text',
            axisLabel: '',
            axisPlacement: 'auto',
            barAlignment: 0,
            drawStyle: 'line',
            fillOpacity: 10,
            gradientMode: 'none',
            hideFrom: {
              legend: false,
              tooltip: false,
              viz: false,
            },
            insertNulls: false,
            lineInterpolation: 'linear',
            lineWidth: 1,
            pointSize: 5,
            scaleDistribution: {
              type: 'linear',
            },
            showPoints: 'never',
            spanNulls: false,
            stacking: {
              group: 'A',
              mode: 'none',
            },
            thresholdsStyle: {
              mode: options.thresholds ? 'line' : 'off',
            },
          },
          thresholds: options.thresholds
            ? {
                mode: 'absolute',
                steps: options.thresholds,
              }
            : undefined,
          unit: options.unit,
        },
        overrides: [],
      },
      options: {
        legend: {
          calcs: ['last', 'mean'],
          displayMode: 'table',
          placement: 'bottom',
          showLegend: true,
        },
        tooltip: {
          mode: 'multi',
          sort: 'desc',
        },
      },
    };
  }

  /**
   * 创建统计面板
   */
  private createStatPanel(options: {
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    expr: string;
    unit: string;
    thresholds?: ThresholdConfig[];
    legendFormat?: string;
    mappings?: unknown[];
  }): GrafanaPanel {
    // 生成面板 ID
    const id = this.panelIdCounter++;

    return {
      id,
      type: 'stat',
      title: options.title,
      gridPos: {
        x: options.x,
        y: options.y,
        w: options.w,
        h: options.h,
      },
      datasource: {
        type: 'prometheus',
        uid: this.config.prometheusUid,
      },
      targets: [
        {
          datasource: {
            type: 'prometheus',
            uid: this.config.prometheusUid,
          },
          expr: options.expr,
          legendFormat: options.legendFormat ?? '',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          mappings: options.mappings ?? [],
          thresholds: {
            mode: 'absolute',
            steps: options.thresholds ?? [{ color: 'green', value: null }],
          },
          unit: options.unit,
        },
        overrides: [],
      },
      options: {
        colorMode: 'value',
        graphMode: 'area',
        justifyMode: 'auto',
        orientation: 'auto',
        reduceOptions: {
          calcs: ['lastNotNull'],
          fields: '',
          values: false,
        },
        textMode: 'auto',
        wideLayout: true,
      },
    };
  }

  /**
   * 创建仪表盘面板
   */
  private createGaugePanel(options: {
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    expr: string;
    unit: string;
    min: number;
    max: number;
    thresholds: ThresholdConfig[];
    legendFormat?: string;
  }): GrafanaPanel {
    // 生成面板 ID
    const id = this.panelIdCounter++;

    return {
      id,
      type: 'gauge',
      title: options.title,
      gridPos: {
        x: options.x,
        y: options.y,
        w: options.w,
        h: options.h,
      },
      datasource: {
        type: 'prometheus',
        uid: this.config.prometheusUid,
      },
      targets: [
        {
          datasource: {
            type: 'prometheus',
            uid: this.config.prometheusUid,
          },
          expr: options.expr,
          legendFormat: options.legendFormat ?? '',
          refId: 'A',
        },
      ],
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          thresholds: {
            mode: 'absolute',
            steps: options.thresholds,
          },
          unit: options.unit,
          min: options.min,
          max: options.max,
        },
        overrides: [],
      },
      options: {
        minVizHeight: 75,
        minVizWidth: 75,
        orientation: 'auto',
        reduceOptions: {
          calcs: ['lastNotNull'],
          fields: '',
          values: false,
        },
        showThresholdLabels: false,
        showThresholdMarkers: true,
        sizing: 'auto',
      },
    };
  }

  /**
   * 创建表格面板
   */
  private createTablePanel(options: {
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    targets: Array<{ expr: string; legendFormat: string; refId: string }>;
  }): GrafanaPanel {
    // 生成面板 ID
    const id = this.panelIdCounter++;

    return {
      id,
      type: 'table',
      title: options.title,
      gridPos: {
        x: options.x,
        y: options.y,
        w: options.w,
        h: options.h,
      },
      datasource: {
        type: 'prometheus',
        uid: this.config.prometheusUid,
      },
      targets: options.targets.map((t) => ({
        datasource: {
          type: 'prometheus',
          uid: this.config.prometheusUid,
        },
        expr: t.expr,
        legendFormat: t.legendFormat,
        refId: t.refId,
        format: 'table',
        instant: true,
      })),
      fieldConfig: {
        defaults: {
          color: {
            mode: 'thresholds',
          },
          custom: {
            align: 'auto',
            cellOptions: {
              type: 'auto',
            },
            inspect: false,
          },
          thresholds: {
            mode: 'absolute',
            steps: [{ color: 'green', value: null }],
          },
        },
        overrides: [],
      },
      options: {
        cellHeight: 'sm',
        footer: {
          countRows: false,
          fields: '',
          reducer: ['sum'],
          show: false,
        },
        showHeader: true,
      },
    };
  }

  // ========================================================================
  // 公共方法 - 导出
  // ========================================================================

  /**
   * 导出仪表盘为 JSON 字符串
   * @param dashboard - 仪表盘配置
   */
  exportToJson(dashboard: GrafanaDashboard): string {
    return JSON.stringify(dashboard, null, 2);
  }

  /**
   * 生成所有仪表盘
   */
  generateAllDashboards(): Map<string, GrafanaDashboard> {
    // 结果映射
    const dashboards = new Map<string, GrafanaDashboard>();

    // 生成主仪表盘
    dashboards.set('main', this.generateMainDashboard());

    // 生成 PnL 详情仪表盘
    dashboards.set('pnl', this.generatePnlDashboard());

    return dashboards;
  }
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建 Grafana 仪表盘生成器
 * @param config - 配置
 */
export function createGrafanaDashboardGenerator(
  config?: Partial<DashboardGeneratorConfig>
): GrafanaDashboardGenerator {
  return new GrafanaDashboardGenerator(config);
}

// 导出默认配置
export { DEFAULT_GENERATOR_CONFIG };
