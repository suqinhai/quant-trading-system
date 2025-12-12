// ============================================================================
// Telegram 机器人通知服务
// 支持实时告警推送、每日绩效报告、交互式命令查询
// ============================================================================

// ============================================================================
// 类型定义
// ============================================================================

// Telegram 消息解析模式
export type ParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

// 消息优先级
export type MessagePriority = 'low' | 'normal' | 'high' | 'critical';

// 告警类型
export type AlertType =
  | 'margin_warning'      // 保证金预警
  | 'margin_critical'     // 保证金危急
  | 'pnl_warning'         // PnL 预警
  | 'latency_warning'     // 延迟预警
  | 'error_rate_warning'  // 错误率预警
  | 'strategy_stopped'    // 策略停止
  | 'order_failed'        // 订单失败
  | 'system_error'        // 系统错误
  | 'daily_report';       // 每日报告

// Telegram 配置
export interface TelegramBotConfig {
  // 机器人 Token
  botToken: string;
  // 聊天 ID（可以是用户 ID 或群组 ID）
  chatId: string;
  // 管理员聊天 ID（用于接收紧急告警）
  adminChatId?: string;
  // 解析模式
  parseMode: ParseMode;
  // 是否启用
  enabled: boolean;
  // 消息发送间隔（毫秒，防止触发限流）
  sendInterval: number;
  // 重试次数
  maxRetries: number;
  // 重试间隔（毫秒）
  retryInterval: number;
  // 是否启用静默时段（夜间不发送非紧急消息）
  enableQuietHours: boolean;
  // 静默时段开始（小时，0-23）
  quietHoursStart: number;
  // 静默时段结束（小时，0-23）
  quietHoursEnd: number;
  // 每日报告时间（小时，0-23）
  dailyReportHour: number;
  // 时区偏移（小时，如北京时间为 8）
  timezoneOffset: number;
}

// 默认配置
const DEFAULT_TELEGRAM_CONFIG: TelegramBotConfig = {
  // 机器人 Token（需要从 @BotFather 获取）
  botToken: '',
  // 默认聊天 ID
  chatId: '',
  // 管理员 ID
  adminChatId: undefined,
  // 使用 HTML 解析模式（更灵活）
  parseMode: 'HTML',
  // 默认启用
  enabled: true,
  // 发送间隔 100ms
  sendInterval: 100,
  // 最多重试 3 次
  maxRetries: 3,
  // 重试间隔 1 秒
  retryInterval: 1000,
  // 启用静默时段
  enableQuietHours: false,
  // 静默时段：23:00 - 07:00
  quietHoursStart: 23,
  quietHoursEnd: 7,
  // 每日报告时间：0 点
  dailyReportHour: 0,
  // 北京时间
  timezoneOffset: 8,
};

// 告警消息
export interface AlertMessage {
  // 告警类型
  type: AlertType;
  // 优先级
  priority: MessagePriority;
  // 标题
  title: string;
  // 消息内容
  content: string;
  // 附加数据
  data?: Record<string, unknown>;
  // 时间戳
  timestamp: number;
}

// 绩效报告数据
export interface PerformanceReport {
  // 报告日期
  date: string;
  // 总权益
  totalEquity: number;
  // 当日 PnL
  dailyPnl: number;
  // 当日收益率
  dailyReturn: number;
  // 累计 PnL
  cumulativePnl: number;
  // 累计收益率
  cumulativeReturn: number;
  // 当日最大回撤
  dailyMaxDrawdown: number;
  // 累计最大回撤
  cumulativeMaxDrawdown: number;
  // 夏普比率
  sharpeRatio: number;
  // 胜率
  winRate: number;
  // 交易次数
  tradeCount: number;
  // 盈利交易数
  winCount: number;
  // 亏损交易数
  lossCount: number;
  // 平均盈利
  avgWin: number;
  // 平均亏损
  avgLoss: number;
  // 盈亏比
  profitFactor: number;
  // 各策略绩效
  strategyPerformance: StrategyPerformance[];
  // 各交易所保证金率
  marginRatios: ExchangeMarginRatio[];
  // API 统计
  apiStats: ApiStats;
}

// 策略绩效
export interface StrategyPerformance {
  // 策略名称
  name: string;
  // 当日 PnL
  dailyPnl: number;
  // 当日收益率
  dailyReturn: number;
  // 交易次数
  tradeCount: number;
  // 胜率
  winRate: number;
}

// 交易所保证金率
export interface ExchangeMarginRatio {
  // 交易所
  exchange: string;
  // 保证金率
  marginRatio: number;
  // 总权益
  totalEquity: number;
}

// API 统计
export interface ApiStats {
  // 总请求数
  totalRequests: number;
  // 错误数
  errorCount: number;
  // 错误率
  errorRate: number;
  // 平均延迟（毫秒）
  avgLatency: number;
  // P99 延迟
  p99Latency: number;
}

// 消息队列项
interface QueuedMessage {
  // 聊天 ID
  chatId: string;
  // 消息内容
  text: string;
  // 解析模式
  parseMode: ParseMode;
  // 优先级
  priority: MessagePriority;
  // 重试次数
  retryCount: number;
  // 创建时间
  createdAt: number;
}

// 命令处理器类型
type CommandHandler = (args: string[], chatId: string) => Promise<string>;

// ============================================================================
// Telegram 机器人类
// ============================================================================

/**
 * Telegram 机器人通知服务
 * 支持告警推送、每日报告、交互式查询
 */
export class TelegramBot {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private config: TelegramBotConfig;

  // Telegram API 基础 URL
  private apiBaseUrl: string;

  // 消息队列
  private messageQueue: QueuedMessage[] = [];

  // 是否正在处理队列
  private isProcessingQueue: boolean = false;

  // 命令处理器映射
  private commandHandlers: Map<string, CommandHandler> = new Map();

  // 每日报告定时器
  private dailyReportTimer: ReturnType<typeof setTimeout> | null = null;

  // 轮询定时器（用于接收消息）
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  // 最后处理的更新 ID
  private lastUpdateId: number = 0;

  // 是否正在运行
  private running: boolean = false;

  // 数据获取回调（用于获取实时数据）
  private dataProvider: DataProvider | null = null;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - 配置
   */
  constructor(config?: Partial<TelegramBotConfig>) {
    // 合并配置
    this.config = { ...DEFAULT_TELEGRAM_CONFIG, ...config };

    // 构建 API URL
    this.apiBaseUrl = `https://api.telegram.org/bot${this.config.botToken}`;

    // 注册内置命令
    this.registerBuiltInCommands();
  }

  // ========================================================================
  // 公共方法 - 生命周期
  // ========================================================================

  /**
   * 启动机器人
   * @param dataProvider - 数据提供器（可选）
   */
  start(dataProvider?: DataProvider): void {
    // 检查是否已配置
    if (!this.config.botToken || !this.config.chatId) {
      console.warn('Telegram 机器人未配置 botToken 或 chatId，跳过启动');
      return;
    }

    // 保存数据提供器
    this.dataProvider = dataProvider || null;

    // 设置运行状态
    this.running = true;

    // 启动消息轮询（接收用户命令）
    this.startPolling();

    // 启动每日报告定时器
    this.scheduleDailyReport();

    // 发送启动通知
    this.sendAlert({
      type: 'system_error',
      priority: 'normal',
      title: '🚀 系统启动',
      content: '量化交易监控系统已启动',
      timestamp: Date.now(),
    });
  }

  /**
   * 停止机器人
   */
  stop(): void {
    // 设置运行状态
    this.running = false;

    // 停止轮询
    this.stopPolling();

    // 停止每日报告定时器
    if (this.dailyReportTimer) {
      clearTimeout(this.dailyReportTimer);
      this.dailyReportTimer = null;
    }

    // 发送停止通知（同步发送）
    this.sendMessageSync(
      this.config.chatId,
      '⚠️ <b>系统停止</b>\n\n量化交易监控系统已停止运行',
      this.config.parseMode
    );
  }

  /**
   * 重置机器人
   */
  reset(): void {
    // 停止
    this.stop();

    // 清空队列
    this.messageQueue = [];

    // 重置状态
    this.lastUpdateId = 0;
    this.isProcessingQueue = false;
  }

  // ========================================================================
  // 公共方法 - 发送消息
  // ========================================================================

  /**
   * 发送告警
   * @param alert - 告警消息
   */
  async sendAlert(alert: AlertMessage): Promise<boolean> {
    // 检查是否启用
    if (!this.config.enabled) {
      return false;
    }

    // 检查静默时段
    if (this.isInQuietHours() && alert.priority !== 'critical') {
      // 非紧急消息在静默时段不发送
      return false;
    }

    // 格式化告警消息
    const text = this.formatAlertMessage(alert);

    // 确定目标聊天 ID
    const chatId =
      alert.priority === 'critical' && this.config.adminChatId
        ? this.config.adminChatId
        : this.config.chatId;

    // 添加到队列
    return this.queueMessage(chatId, text, alert.priority);
  }

  /**
   * 发送每日绩效报告
   * @param report - 绩效报告数据
   */
  async sendDailyReport(report: PerformanceReport): Promise<boolean> {
    // 检查是否启用
    if (!this.config.enabled) {
      return false;
    }

    // 格式化报告
    const text = this.formatDailyReport(report);

    // 发送报告（高优先级）
    return this.queueMessage(this.config.chatId, text, 'high');
  }

  /**
   * 发送保证金预警
   * @param exchange - 交易所
   * @param marginRatio - 保证金率
   * @param threshold - 触发阈值
   */
  async sendMarginAlert(
    exchange: string,
    marginRatio: number,
    threshold: number
  ): Promise<boolean> {
    // 确定优先级
    let priority: MessagePriority;
    let alertType: AlertType;

    // 根据阈值确定级别
    if (threshold <= 0.30) {
      priority = 'critical';
      alertType = 'margin_critical';
    } else {
      priority = 'high';
      alertType = 'margin_warning';
    }

    // 发送告警
    return this.sendAlert({
      type: alertType,
      priority,
      title: `⚠️ 保证金预警 - ${exchange}`,
      content: [
        `当前保证金率: <b>${(marginRatio * 100).toFixed(2)}%</b>`,
        `预警阈值: <b>${(threshold * 100).toFixed(0)}%</b>`,
        '',
        '请及时关注账户风险！',
      ].join('\n'),
      data: { exchange, marginRatio, threshold },
      timestamp: Date.now(),
    });
  }

  /**
   * 发送延迟预警
   * @param exchange - 交易所
   * @param operation - 操作类型
   * @param latencyMs - 延迟（毫秒）
   */
  async sendLatencyAlert(
    exchange: string,
    operation: string,
    latencyMs: number
  ): Promise<boolean> {
    return this.sendAlert({
      type: 'latency_warning',
      priority: 'normal',
      title: `🐢 高延迟预警 - ${exchange}`,
      content: [
        `操作类型: <b>${operation}</b>`,
        `当前延迟: <b>${latencyMs.toFixed(0)}ms</b>`,
        '',
        '网络可能存在问题，请检查连接',
      ].join('\n'),
      data: { exchange, operation, latencyMs },
      timestamp: Date.now(),
    });
  }

  /**
   * 发送错误率预警
   * @param exchange - 交易所
   * @param errorRate - 错误率
   */
  async sendErrorRateAlert(
    exchange: string,
    errorRate: number
  ): Promise<boolean> {
    return this.sendAlert({
      type: 'error_rate_warning',
      priority: 'high',
      title: `❌ API 错误率预警 - ${exchange}`,
      content: [
        `当前错误率: <b>${(errorRate * 100).toFixed(2)}%</b>`,
        '',
        '请检查 API 配置或交易所状态',
      ].join('\n'),
      data: { exchange, errorRate },
      timestamp: Date.now(),
    });
  }

  /**
   * 发送自定义消息
   * @param text - 消息内容
   * @param priority - 优先级
   */
  async sendCustomMessage(
    text: string,
    priority: MessagePriority = 'normal'
  ): Promise<boolean> {
    return this.queueMessage(this.config.chatId, text, priority);
  }

  // ========================================================================
  // 公共方法 - 命令注册
  // ========================================================================

  /**
   * 注册命令处理器
   * @param command - 命令名（不含斜杠）
   * @param handler - 处理器函数
   */
  registerCommand(command: string, handler: CommandHandler): void {
    this.commandHandlers.set(command.toLowerCase(), handler);
  }

  /**
   * 移除命令处理器
   * @param command - 命令名
   */
  unregisterCommand(command: string): void {
    this.commandHandlers.delete(command.toLowerCase());
  }

  // ========================================================================
  // 私有方法 - 消息格式化
  // ========================================================================

  /**
   * 格式化告警消息
   * @param alert - 告警消息
   */
  private formatAlertMessage(alert: AlertMessage): string {
    // 获取优先级图标
    const priorityIcon = this.getPriorityIcon(alert.priority);

    // 获取时间字符串
    const timeStr = this.formatTime(alert.timestamp);

    // 构建消息
    const lines = [
      `${priorityIcon} <b>${alert.title}</b>`,
      '',
      alert.content,
      '',
      `<i>⏰ ${timeStr}</i>`,
    ];

    return lines.join('\n');
  }

  /**
   * 格式化每日绩效报告
   * @param report - 绩效报告
   */
  private formatDailyReport(report: PerformanceReport): string {
    // 获取 PnL 图标
    const pnlIcon = report.dailyPnl >= 0 ? '📈' : '📉';

    // 构建消息
    const lines = [
      `📊 <b>每日绩效报告</b>`,
      `📅 ${report.date}`,
      '',
      `━━━━━━ 收益概览 ━━━━━━`,
      `${pnlIcon} 当日 PnL: <b>${this.formatPnl(report.dailyPnl)}</b> (${this.formatPercent(report.dailyReturn)})`,
      `💰 累计 PnL: <b>${this.formatPnl(report.cumulativePnl)}</b> (${this.formatPercent(report.cumulativeReturn)})`,
      `💵 总权益: <b>${this.formatMoney(report.totalEquity)}</b>`,
      '',
      `━━━━━━ 风险指标 ━━━━━━`,
      `📉 当日最大回撤: ${this.formatPercent(report.dailyMaxDrawdown)}`,
      `📉 累计最大回撤: ${this.formatPercent(report.cumulativeMaxDrawdown)}`,
      `⚡ 夏普比率: ${report.sharpeRatio.toFixed(2)}`,
      '',
      `━━━━━━ 交易统计 ━━━━━━`,
      `🔢 交易次数: ${report.tradeCount}`,
      `✅ 盈利: ${report.winCount} | ❌ 亏损: ${report.lossCount}`,
      `🎯 胜率: ${this.formatPercent(report.winRate)}`,
      `📊 盈亏比: ${report.profitFactor.toFixed(2)}`,
      `💹 平均盈利: ${this.formatPnl(report.avgWin)}`,
      `💸 平均亏损: ${this.formatPnl(report.avgLoss)}`,
    ];

    // 添加策略绩效
    if (report.strategyPerformance.length > 0) {
      lines.push('');
      lines.push(`━━━━━━ 策略绩效 ━━━━━━`);

      for (const strategy of report.strategyPerformance) {
        const icon = strategy.dailyPnl >= 0 ? '🟢' : '🔴';
        lines.push(
          `${icon} ${strategy.name}: ${this.formatPnl(strategy.dailyPnl)} (${this.formatPercent(strategy.dailyReturn)})`
        );
      }
    }

    // 添加保证金率
    if (report.marginRatios.length > 0) {
      lines.push('');
      lines.push(`━━━━━━ 保证金率 ━━━━━━`);

      for (const margin of report.marginRatios) {
        const icon = this.getMarginIcon(margin.marginRatio);
        lines.push(
          `${icon} ${margin.exchange}: ${this.formatPercent(margin.marginRatio)}`
        );
      }
    }

    // 添加 API 统计
    lines.push('');
    lines.push(`━━━━━━ API 统计 ━━━━━━`);
    lines.push(`📡 总请求: ${report.apiStats.totalRequests}`);
    lines.push(`❌ 错误数: ${report.apiStats.errorCount} (${this.formatPercent(report.apiStats.errorRate)})`);
    lines.push(`⏱️ 平均延迟: ${report.apiStats.avgLatency.toFixed(0)}ms`);
    lines.push(`⏱️ P99 延迟: ${report.apiStats.p99Latency.toFixed(0)}ms`);

    return lines.join('\n');
  }

  /**
   * 获取优先级图标
   * @param priority - 优先级
   */
  private getPriorityIcon(priority: MessagePriority): string {
    // 根据优先级返回图标
    switch (priority) {
      case 'low':
        return 'ℹ️';
      case 'normal':
        return '📢';
      case 'high':
        return '⚠️';
      case 'critical':
        return '🚨';
      default:
        return '📢';
    }
  }

  /**
   * 获取保证金率图标
   * @param ratio - 保证金率
   */
  private getMarginIcon(ratio: number): string {
    // 根据保证金率返回图标
    if (ratio >= 0.40) {
      return '🟢';
    } else if (ratio >= 0.35) {
      return '🟡';
    } else if (ratio >= 0.30) {
      return '🟠';
    } else {
      return '🔴';
    }
  }

  /**
   * 格式化时间
   * @param timestamp - 时间戳
   */
  private formatTime(timestamp: number): string {
    // 创建日期对象
    const date = new Date(timestamp);

    // 调整时区
    const localDate = new Date(
      date.getTime() + this.config.timezoneOffset * 60 * 60 * 1000
    );

    // 格式化
    const year = localDate.getUTCFullYear();
    const month = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localDate.getUTCDate()).padStart(2, '0');
    const hours = String(localDate.getUTCHours()).padStart(2, '0');
    const minutes = String(localDate.getUTCMinutes()).padStart(2, '0');
    const seconds = String(localDate.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * 格式化金额
   * @param amount - 金额
   */
  private formatMoney(amount: number): string {
    // 格式化为带千分位的字符串
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  /**
   * 格式化 PnL
   * @param pnl - PnL 值
   */
  private formatPnl(pnl: number): string {
    // 添加正负号
    const sign = pnl >= 0 ? '+' : '';
    return `${sign}${this.formatMoney(pnl)}`;
  }

  /**
   * 格式化百分比
   * @param ratio - 比率（0-1）
   */
  private formatPercent(ratio: number): string {
    // 添加正负号
    const sign = ratio >= 0 ? '+' : '';
    return `${sign}${(ratio * 100).toFixed(2)}%`;
  }

  // ========================================================================
  // 私有方法 - 消息发送
  // ========================================================================

  /**
   * 将消息添加到队列
   * @param chatId - 聊天 ID
   * @param text - 消息内容
   * @param priority - 优先级
   */
  private async queueMessage(
    chatId: string,
    text: string,
    priority: MessagePriority
  ): Promise<boolean> {
    // 创建队列项
    const queuedMessage: QueuedMessage = {
      chatId,
      text,
      parseMode: this.config.parseMode,
      priority,
      retryCount: 0,
      createdAt: Date.now(),
    };

    // 添加到队列（按优先级排序）
    this.insertByPriority(queuedMessage);

    // 触发队列处理
    this.processQueue();

    return true;
  }

  /**
   * 按优先级插入消息
   * @param message - 消息
   */
  private insertByPriority(message: QueuedMessage): void {
    // 获取优先级权重
    const weight = this.getPriorityWeight(message.priority);

    // 找到插入位置
    let insertIndex = this.messageQueue.length;

    // 从后向前查找
    for (let i = this.messageQueue.length - 1; i >= 0; i--) {
      const existingWeight = this.getPriorityWeight(this.messageQueue[i]!.priority);

      // 如果当前消息优先级更高，继续向前
      if (weight > existingWeight) {
        insertIndex = i;
      } else {
        break;
      }
    }

    // 插入消息
    this.messageQueue.splice(insertIndex, 0, message);
  }

  /**
   * 获取优先级权重
   * @param priority - 优先级
   */
  private getPriorityWeight(priority: MessagePriority): number {
    // 返回权重值
    switch (priority) {
      case 'critical':
        return 4;
      case 'high':
        return 3;
      case 'normal':
        return 2;
      case 'low':
        return 1;
      default:
        return 2;
    }
  }

  /**
   * 处理消息队列
   */
  private async processQueue(): Promise<void> {
    // 如果已在处理，跳过
    if (this.isProcessingQueue) {
      return;
    }

    // 设置处理标志
    this.isProcessingQueue = true;

    try {
      // 循环处理队列
      while (this.messageQueue.length > 0) {
        // 获取队首消息
        const message = this.messageQueue.shift();

        // 如果队列为空，跳过
        if (!message) {
          break;
        }

        // 发送消息
        const success = await this.sendMessageWithRetry(message);

        // 如果发送失败且未超过重试次数，重新入队
        if (!success && message.retryCount < this.config.maxRetries) {
          message.retryCount++;
          this.messageQueue.push(message);
        }

        // 等待发送间隔
        await this.sleep(this.config.sendInterval);
      }
    } finally {
      // 清除处理标志
      this.isProcessingQueue = false;
    }
  }

  /**
   * 带重试的消息发送
   * @param message - 队列消息
   */
  private async sendMessageWithRetry(message: QueuedMessage): Promise<boolean> {
    try {
      // 调用 Telegram API
      const response = await this.callTelegramApi('sendMessage', {
        chat_id: message.chatId,
        text: message.text,
        parse_mode: message.parseMode,
        disable_notification: message.priority === 'low',
      });

      // 检查响应
      return response.ok === true;
    } catch (error) {
      // 记录错误
      console.error('Telegram 消息发送失败:', error);

      // 如果是限流错误，等待后重试
      if (error instanceof Error && error.message.includes('429')) {
        await this.sleep(this.config.retryInterval * 3);
      }

      return false;
    }
  }

  /**
   * 同步发送消息（用于关闭时）
   * @param chatId - 聊天 ID
   * @param text - 消息内容
   * @param parseMode - 解析模式
   */
  private async sendMessageSync(
    chatId: string,
    text: string,
    parseMode: ParseMode
  ): Promise<void> {
    try {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      });
    } catch (error) {
      console.error('Telegram 同步消息发送失败:', error);
    }
  }

  /**
   * 调用 Telegram API
   * @param method - API 方法
   * @param params - 参数
   */
  private async callTelegramApi(
    method: string,
    params: Record<string, unknown>
  ): Promise<TelegramApiResponse> {
    // 构建 URL
    const url = `${this.apiBaseUrl}/${method}`;

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    // 解析响应
    const data = await response.json() as TelegramApiResponse;

    // 检查错误
    if (!data.ok) {
      throw new Error(`Telegram API 错误: ${data.description || 'Unknown error'}`);
    }

    return data;
  }

  // ========================================================================
  // 私有方法 - 消息轮询
  // ========================================================================

  /**
   * 启动消息轮询
   */
  private startPolling(): void {
    // 如果已在轮询，跳过
    if (this.pollingTimer) {
      return;
    }

    // 每 2 秒轮询一次
    this.pollingTimer = setInterval(async () => {
      await this.pollUpdates();
    }, 2000);
  }

  /**
   * 停止消息轮询
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * 轮询更新
   */
  private async pollUpdates(): Promise<void> {
    // 如果未运行，跳过
    if (!this.running) {
      return;
    }

    try {
      // 获取更新
      const response = await this.callTelegramApi('getUpdates', {
        offset: this.lastUpdateId + 1,
        timeout: 1,
        allowed_updates: ['message'],
      });

      // 处理更新
      const updates = (response.result as TelegramUpdate[]) || [];

      // 遍历更新
      for (const update of updates) {
        // 更新最后 ID
        this.lastUpdateId = update.update_id;

        // 处理消息
        if (update.message?.text) {
          await this.handleMessage(update.message);
        }
      }
    } catch (error) {
      // 忽略轮询错误
      console.error('Telegram 轮询错误:', error);
    }
  }

  /**
   * 处理接收到的消息
   * @param message - Telegram 消息
   */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    // 获取消息文本
    const text = message.text || '';

    // 检查是否是命令
    if (!text.startsWith('/')) {
      return;
    }

    // 解析命令和参数
    const parts = text.slice(1).split(' ');
    const command = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1);

    // 获取聊天 ID
    const chatId = String(message.chat.id);

    // 查找命令处理器
    const handler = this.commandHandlers.get(command);

    // 如果找到处理器，执行
    if (handler) {
      try {
        const response = await handler(args, chatId);

        // 发送响应
        await this.sendMessageSync(chatId, response, this.config.parseMode);
      } catch (error) {
        // 发送错误消息
        await this.sendMessageSync(
          chatId,
          `❌ 命令执行失败: ${error}`,
          this.config.parseMode
        );
      }
    } else {
      // 未知命令
      await this.sendMessageSync(
        chatId,
        `❓ 未知命令: /${command}\n\n使用 /help 查看可用命令`,
        this.config.parseMode
      );
    }
  }

  // ========================================================================
  // 私有方法 - 内置命令
  // ========================================================================

  /**
   * 注册内置命令
   */
  private registerBuiltInCommands(): void {
    // /help - 帮助
    this.registerCommand('help', async () => {
      return [
        '📚 <b>可用命令</b>',
        '',
        '/help - 显示此帮助信息',
        '/status - 查看系统状态',
        '/pnl - 查看当前 PnL',
        '/margin - 查看保证金率',
        '/positions - 查看当前持仓',
        '/latency - 查看 API 延迟',
        '/report - 手动生成当日报告',
        '/pause - 暂停策略',
        '/resume - 恢复策略',
      ].join('\n');
    });

    // /status - 系统状态
    this.registerCommand('status', async () => {
      // 获取数据
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      const status = await this.dataProvider.getSystemStatus();

      return [
        '🖥️ <b>系统状态</b>',
        '',
        `📊 运行状态: ${status.running ? '✅ 运行中' : '⏹️ 已停止'}`,
        `⏱️ 运行时间: ${this.formatDuration(status.uptime)}`,
        `💾 内存使用: ${(status.memoryUsage / 1024 / 1024).toFixed(1)} MB`,
        `📡 活跃连接: ${status.activeConnections}`,
        `📈 活跃策略: ${status.activeStrategies}`,
      ].join('\n');
    });

    // /pnl - 当前 PnL
    this.registerCommand('pnl', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      const pnl = await this.dataProvider.getCurrentPnl();

      return [
        '💰 <b>当前 PnL</b>',
        '',
        `📊 总权益: ${this.formatMoney(pnl.totalEquity)}`,
        `${pnl.dailyPnl >= 0 ? '📈' : '📉'} 当日 PnL: ${this.formatPnl(pnl.dailyPnl)} (${this.formatPercent(pnl.dailyReturn)})`,
        `💵 累计 PnL: ${this.formatPnl(pnl.cumulativePnl)}`,
        `📉 当日回撤: ${this.formatPercent(pnl.dailyDrawdown)}`,
      ].join('\n');
    });

    // /margin - 保证金率
    this.registerCommand('margin', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      const margins = await this.dataProvider.getMarginRatios();

      const lines = ['🏦 <b>保证金率</b>', ''];

      for (const margin of margins) {
        const icon = this.getMarginIcon(margin.marginRatio);
        lines.push(
          `${icon} ${margin.exchange}: ${this.formatPercent(margin.marginRatio)} (${this.formatMoney(margin.totalEquity)})`
        );
      }

      return lines.join('\n');
    });

    // /positions - 当前持仓
    this.registerCommand('positions', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      const positions = await this.dataProvider.getPositions();

      if (positions.length === 0) {
        return '📭 当前无持仓';
      }

      const lines = ['📊 <b>当前持仓</b>', ''];

      for (const pos of positions) {
        const sideIcon = pos.side === 'long' ? '🟢' : '🔴';
        const pnlIcon = pos.unrealizedPnl >= 0 ? '📈' : '📉';

        lines.push(
          `${sideIcon} <b>${pos.symbol}</b> @ ${pos.exchange}`,
          `   数量: ${pos.quantity}`,
          `   均价: ${pos.entryPrice.toFixed(2)}`,
          `   ${pnlIcon} PnL: ${this.formatPnl(pos.unrealizedPnl)}`,
          ''
        );
      }

      return lines.join('\n');
    });

    // /latency - API 延迟
    this.registerCommand('latency', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      const latencies = await this.dataProvider.getLatencyStats();

      const lines = ['⏱️ <b>API 延迟</b>', ''];

      for (const stat of latencies) {
        const icon = stat.avgLatency < 100 ? '🟢' : stat.avgLatency < 300 ? '🟡' : '🔴';

        lines.push(
          `${icon} <b>${stat.exchange}</b>`,
          `   平均: ${stat.avgLatency.toFixed(0)}ms`,
          `   P95: ${stat.p95Latency.toFixed(0)}ms`,
          `   P99: ${stat.p99Latency.toFixed(0)}ms`,
          ''
        );
      }

      return lines.join('\n');
    });

    // /report - 手动生成报告
    this.registerCommand('report', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      // 生成报告
      const report = await this.dataProvider.generateDailyReport();

      // 发送报告
      await this.sendDailyReport(report);

      return '✅ 每日报告已发送';
    });

    // /pause - 暂停策略
    this.registerCommand('pause', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      await this.dataProvider.pauseStrategies('用户手动暂停');

      return '⏸️ 策略已暂停';
    });

    // /resume - 恢复策略
    this.registerCommand('resume', async () => {
      if (!this.dataProvider) {
        return '❌ 数据提供器未配置';
      }

      await this.dataProvider.resumeStrategies();

      return '▶️ 策略已恢复';
    });
  }

  /**
   * 格式化持续时间
   * @param seconds - 秒数
   */
  private formatDuration(seconds: number): string {
    // 计算天、时、分、秒
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    // 构建字符串
    const parts = [];

    if (days > 0) {
      parts.push(`${days}天`);
    }

    if (hours > 0) {
      parts.push(`${hours}小时`);
    }

    if (minutes > 0) {
      parts.push(`${minutes}分钟`);
    }

    return parts.join(' ') || '< 1分钟';
  }

  // ========================================================================
  // 私有方法 - 每日报告
  // ========================================================================

  /**
   * 调度每日报告
   */
  private scheduleDailyReport(): void {
    // 计算下一次报告时间
    const now = new Date();

    // 获取当前时区时间
    const localHour = (now.getUTCHours() + this.config.timezoneOffset) % 24;

    // 计算距离报告时间的小时数
    let hoursUntilReport = this.config.dailyReportHour - localHour;

    // 如果已过报告时间，等到明天
    if (hoursUntilReport <= 0) {
      hoursUntilReport += 24;
    }

    // 计算毫秒数
    const msUntilReport =
      hoursUntilReport * 60 * 60 * 1000 -
      now.getMinutes() * 60 * 1000 -
      now.getSeconds() * 1000;

    // 设置定时器
    this.dailyReportTimer = setTimeout(async () => {
      // 生成并发送报告
      await this.generateAndSendDailyReport();

      // 重新调度
      this.scheduleDailyReport();
    }, msUntilReport);
  }

  /**
   * 生成并发送每日报告
   */
  private async generateAndSendDailyReport(): Promise<void> {
    // 检查数据提供器
    if (!this.dataProvider) {
      console.warn('无法生成每日报告：数据提供器未配置');
      return;
    }

    try {
      // 生成报告
      const report = await this.dataProvider.generateDailyReport();

      // 发送报告
      await this.sendDailyReport(report);
    } catch (error) {
      console.error('每日报告生成失败:', error);

      // 发送错误通知
      await this.sendAlert({
        type: 'system_error',
        priority: 'high',
        title: '❌ 每日报告生成失败',
        content: `错误: ${error}`,
        timestamp: Date.now(),
      });
    }
  }

  // ========================================================================
  // 私有方法 - 工具
  // ========================================================================

  /**
   * 检查是否在静默时段
   */
  private isInQuietHours(): boolean {
    // 如果未启用静默时段，返回 false
    if (!this.config.enableQuietHours) {
      return false;
    }

    // 获取当前时区小时
    const now = new Date();
    const localHour = (now.getUTCHours() + this.config.timezoneOffset) % 24;

    // 检查是否在静默时段
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    // 如果开始时间 > 结束时间（跨午夜）
    if (start > end) {
      return localHour >= start || localHour < end;
    }

    // 正常情况
    return localHour >= start && localHour < end;
  }

  /**
   * 等待指定时间
   * @param ms - 毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 数据提供器接口
// ============================================================================

/**
 * 数据提供器接口
 * 用于获取实时数据
 */
export interface DataProvider {
  // 获取系统状态
  getSystemStatus(): Promise<{
    running: boolean;
    uptime: number;
    memoryUsage: number;
    activeConnections: number;
    activeStrategies: number;
  }>;

  // 获取当前 PnL
  getCurrentPnl(): Promise<{
    totalEquity: number;
    dailyPnl: number;
    dailyReturn: number;
    cumulativePnl: number;
    dailyDrawdown: number;
  }>;

  // 获取保证金率
  getMarginRatios(): Promise<ExchangeMarginRatio[]>;

  // 获取持仓
  getPositions(): Promise<Array<{
    exchange: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    unrealizedPnl: number;
  }>>;

  // 获取延迟统计
  getLatencyStats(): Promise<Array<{
    exchange: string;
    avgLatency: number;
    p95Latency: number;
    p99Latency: number;
  }>>;

  // 生成每日报告
  generateDailyReport(): Promise<PerformanceReport>;

  // 暂停策略
  pauseStrategies(reason: string): Promise<void>;

  // 恢复策略
  resumeStrategies(): Promise<void>;
}

// ============================================================================
// Telegram API 响应类型
// ============================================================================

// Telegram API 响应
interface TelegramApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
}

// Telegram 更新
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// Telegram 消息
interface TelegramMessage {
  message_id: number;
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  from?: {
    id: number;
    username?: string;
  };
}

// ============================================================================
// 导出工厂函数
// ============================================================================

/**
 * 创建 Telegram 机器人
 * @param config - 配置
 */
export function createTelegramBot(
  config?: Partial<TelegramBotConfig>
): TelegramBot {
  return new TelegramBot(config);
}

// 导出默认配置
export { DEFAULT_TELEGRAM_CONFIG };
