// ============================================================================
// 通知发送器
// 支持多种通知渠道：邮件、Webhook、Telegram、钉钉
// ============================================================================

import nodemailer from 'nodemailer';
import pino from 'pino';

import type {
  Alert,
  AlertLevel,
  DingtalkConfig,
  EmailConfig,
  NotificationChannel,
  NotificationChannelConfig,
  TelegramConfig,
  WebhookConfig,
} from './types';

// ============================================================================
// 通知发送器
// ============================================================================

/**
 * 通知发送器
 *
 * 功能：
 * - 支持多种通知渠道
 * - 根据告警级别过滤
 * - 格式化告警消息
 * - 发送失败重试
 */
export class NotificationSender {
  // 日志记录器
  private readonly logger: pino.Logger;

  // 渠道配置列表
  private readonly channels: NotificationChannelConfig[];

  // 邮件发送器缓存
  private emailTransporter?: nodemailer.Transporter;

  /**
   * 构造函数
   */
  public constructor(channels: NotificationChannelConfig[]) {
    this.channels = channels;

    // 初始化日志
    this.logger = pino({
      name: 'NotificationSender',
      level: process.env['LOG_LEVEL'] ?? 'info',
    });

    // 初始化邮件发送器
    this.initEmailTransporter();
  }

  /**
   * 初始化邮件发送器
   */
  private initEmailTransporter(): void {
    // 查找邮件渠道配置
    const emailChannel = this.channels.find(
      c => c.type === 'email' && c.enabled
    );

    if (emailChannel) {
      const config = emailChannel.config as EmailConfig;
      this.emailTransporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      });

      this.logger.info('Email transporter initialized');
    }
  }

  // ==========================================================================
  // 发送方法
  // ==========================================================================

  /**
   * 发送告警通知
   */
  public async send(alert: Alert): Promise<Map<NotificationChannel, boolean>> {
    const results = new Map<NotificationChannel, boolean>();

    // 遍历所有启用的渠道
    for (const channel of this.channels) {
      // 检查是否启用
      if (!channel.enabled) {
        continue;
      }

      // 检查告警级别
      if (!this.shouldSend(alert.level, channel.minLevel)) {
        continue;
      }

      try {
        // 根据渠道类型发送
        switch (channel.type) {
          case 'email':
            await this.sendEmail(alert, channel.config as EmailConfig);
            break;
          case 'webhook':
            await this.sendWebhook(alert, channel.config as WebhookConfig);
            break;
          case 'telegram':
            await this.sendTelegram(alert, channel.config as TelegramConfig);
            break;
          case 'dingtalk':
            await this.sendDingtalk(alert, channel.config as DingtalkConfig);
            break;
          case 'console':
            this.sendConsole(alert);
            break;
        }

        results.set(channel.type, true);
        this.logger.info(
          { channel: channel.type, alertId: alert.id },
          'Notification sent'
        );
      } catch (error) {
        results.set(channel.type, false);
        this.logger.error(
          { channel: channel.type, alertId: alert.id, error },
          'Failed to send notification'
        );
      }
    }

    return results;
  }

  /**
   * 检查是否应该发送
   */
  private shouldSend(alertLevel: AlertLevel, minLevel: AlertLevel): boolean {
    const levels: AlertLevel[] = ['info', 'warning', 'critical', 'emergency'];
    const alertIndex = levels.indexOf(alertLevel);
    const minIndex = levels.indexOf(minLevel);

    return alertIndex >= minIndex;
  }

  // ==========================================================================
  // 各渠道发送实现
  // ==========================================================================

  /**
   * 发送邮件
   */
  private async sendEmail(alert: Alert, config: EmailConfig): Promise<void> {
    if (!this.emailTransporter) {
      throw new Error('Email transporter not initialized');
    }

    // 构建邮件内容
    const subject = `[${alert.level.toUpperCase()}] ${alert.title}`;
    const html = this.formatEmailBody(alert);

    // 发送邮件
    await this.emailTransporter.sendMail({
      from: config.from,
      to: config.to.join(','),
      subject,
      html,
    });
  }

  /**
   * 格式化邮件正文
   */
  private formatEmailBody(alert: Alert): string {
    // 获取级别对应的颜色
    const levelColors: Record<AlertLevel, string> = {
      info: '#17a2b8',
      warning: '#ffc107',
      critical: '#dc3545',
      emergency: '#6f42c1',
    };

    const color = levelColors[alert.level];

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: ${color}; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
          <h2 style="margin: 0;">${alert.title}</h2>
        </div>
        <div style="border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 5px 5px;">
          <p><strong>级别：</strong>${alert.level.toUpperCase()}</p>
          <p><strong>类型：</strong>${alert.type}</p>
          <p><strong>来源：</strong>${alert.source}</p>
          <p><strong>时间：</strong>${new Date(alert.createdAt).toLocaleString()}</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
          <p>${alert.message}</p>
          ${
            alert.data
              ? `
            <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
            <p><strong>附加数据：</strong></p>
            <pre style="background: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto;">${JSON.stringify(alert.data, null, 2)}</pre>
          `
              : ''
          }
        </div>
        <div style="text-align: center; color: #666; font-size: 12px; margin-top: 15px;">
          Quant Trading System Monitor
        </div>
      </div>
    `;
  }

  /**
   * 发送 Webhook
   */
  private async sendWebhook(alert: Alert, config: WebhookConfig): Promise<void> {
    const method = config.method ?? 'POST';
    const timeout = config.timeout ?? 10000;

    // 构建请求体
    const body = JSON.stringify({
      id: alert.id,
      type: alert.type,
      level: alert.level,
      title: alert.title,
      message: alert.message,
      source: alert.source,
      data: alert.data,
      createdAt: alert.createdAt,
      timestamp: new Date(alert.createdAt).toISOString(),
    });

    // 发送请求
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(config.url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook failed with status ${response.status}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 发送 Telegram 消息
   */
  private async sendTelegram(alert: Alert, config: TelegramConfig): Promise<void> {
    // 格式化消息
    const message = this.formatTelegramMessage(alert, config.parseMode);

    // 构建 API URL
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: message,
        parse_mode: config.parseMode,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Telegram API error: ${error}`);
    }
  }

  /**
   * 格式化 Telegram 消息
   */
  private formatTelegramMessage(alert: Alert, parseMode?: string): string {
    // 级别对应的表情
    const levelEmojis: Record<AlertLevel, string> = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨',
      emergency: '🆘',
    };

    const emoji = levelEmojis[alert.level];

    if (parseMode === 'Markdown') {
      return `
${emoji} *${alert.title}*

*级别:* \`${alert.level.toUpperCase()}\`
*类型:* ${alert.type}
*来源:* ${alert.source}
*时间:* ${new Date(alert.createdAt).toLocaleString()}

${alert.message}
      `.trim();
    }

    return `
${emoji} ${alert.title}

级别: ${alert.level.toUpperCase()}
类型: ${alert.type}
来源: ${alert.source}
时间: ${new Date(alert.createdAt).toLocaleString()}

${alert.message}
    `.trim();
  }

  /**
   * 发送钉钉消息
   */
  private async sendDingtalk(alert: Alert, config: DingtalkConfig): Promise<void> {
    // 构建消息体
    const message = {
      msgtype: 'markdown',
      markdown: {
        title: `[${alert.level.toUpperCase()}] ${alert.title}`,
        text: this.formatDingtalkMessage(alert),
      },
      at: {
        atMobiles: config.atMobiles ?? [],
        isAtAll: config.atAll ?? false,
      },
    };

    // 如果有签名密钥，添加签名
    let url = config.webhook;
    if (config.secret) {
      const timestamp = Date.now();
      const sign = await this.generateDingtalkSign(timestamp, config.secret);
      url = `${config.webhook}&timestamp=${timestamp}&sign=${sign}`;
    }

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Dingtalk API error: ${error}`);
    }
  }

  /**
   * 格式化钉钉消息
   */
  private formatDingtalkMessage(alert: Alert): string {
    // 级别对应的颜色标记
    const levelMarks: Record<AlertLevel, string> = {
      info: '🔵',
      warning: '🟡',
      critical: '🔴',
      emergency: '🟣',
    };

    const mark = levelMarks[alert.level];

    return `
### ${mark} ${alert.title}

- **级别:** ${alert.level.toUpperCase()}
- **类型:** ${alert.type}
- **来源:** ${alert.source}
- **时间:** ${new Date(alert.createdAt).toLocaleString()}

---

${alert.message}
    `.trim();
  }

  /**
   * 生成钉钉签名
   */
  private async generateDingtalkSign(timestamp: number, secret: string): Promise<string> {
    // 使用 Web Crypto API 生成 HMAC-SHA256 签名
    const stringToSign = `${timestamp}\n${secret}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(stringToSign);
    const key = encoder.encode(secret);

    // 导入密钥
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // 生成签名
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);

    // Base64 编码
    const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    // URL 编码
    return encodeURIComponent(base64);
  }

  /**
   * 发送到控制台
   */
  private sendConsole(alert: Alert): void {
    // 级别对应的控制台方法
    const consoleMethods: Record<AlertLevel, 'info' | 'warn' | 'error'> = {
      info: 'info',
      warning: 'warn',
      critical: 'error',
      emergency: 'error',
    };

    const method = consoleMethods[alert.level];
    const timestamp = new Date(alert.createdAt).toISOString();

    console[method](
      `[${timestamp}] [${alert.level.toUpperCase()}] [${alert.source}] ${alert.title}: ${alert.message}`
    );
  }
}
