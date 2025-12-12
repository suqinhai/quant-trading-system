// ============================================================================
// WebSocket 连接管理器
// 管理各交易所的 WebSocket 连接，支持自动重连和心跳
// ============================================================================

import WebSocket from 'ws';
import { EventEmitter } from 'eventemitter3';

import {
  type ExchangeId,
  type ChannelType,
  type WsConnectionState,
  type WsConnectionInfo,
} from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * WebSocket 管理器事件
 */
interface WsManagerEvents {
  // 收到原始消息
  message: (exchange: ExchangeId, data: string) => void;
  // 连接成功
  connected: (exchange: ExchangeId) => void;
  // 连接断开
  disconnected: (exchange: ExchangeId, reason: string) => void;
  // 正在重连
  reconnecting: (exchange: ExchangeId, attempt: number) => void;
  // 错误
  error: (exchange: ExchangeId, error: Error) => void;
}

/**
 * WebSocket 连接配置
 */
interface WsConfig {
  // 重连基础延迟（毫秒）
  reconnectBaseDelay: number;
  // 重连最大延迟
  reconnectMaxDelay: number;
  // 最大重连次数
  maxReconnectAttempts: number;
  // 心跳间隔（毫秒）
  heartbeatInterval: number;
}

/**
 * 交易所 WebSocket 端点配置
 */
interface ExchangeWsEndpoint {
  // 公共流 URL
  publicUrl: string;
  // 私有流 URL（暂不使用）
  privateUrl?: string;
  // 心跳消息
  pingMessage: string | (() => string);
  // 心跳响应（用于检测）
  pongPattern: string | RegExp;
}

// ============================================================================
// 交易所 WebSocket 端点配置
// ============================================================================

/**
 * 各交易所 WebSocket 端点
 * 包含公共流地址和心跳配置
 */
const EXCHANGE_ENDPOINTS: Record<ExchangeId, ExchangeWsEndpoint> = {
  // Binance USDT 永续合约
  binance: {
    // 公共流地址（组合流）
    publicUrl: 'wss://fstream.binance.com/stream',
    // Binance 使用 WebSocket 原生 ping/pong
    pingMessage: '',
    pongPattern: '',
  },

  // Bybit V5 线性合约
  bybit: {
    // 公共流地址
    publicUrl: 'wss://stream.bybit.com/v5/public/linear',
    // Bybit 使用 JSON ping
    pingMessage: JSON.stringify({ op: 'ping' }),
    pongPattern: '"op":"pong"',
  },

  // OKX V5 API
  okx: {
    // 公共流地址
    publicUrl: 'wss://ws.okx.com:8443/ws/v5/public',
    // OKX 使用字符串 ping
    pingMessage: 'ping',
    pongPattern: 'pong',
  },
};

// ============================================================================
// WebSocket 连接管理器
// ============================================================================

/**
 * WebSocket 连接管理器
 *
 * 功能：
 * - 管理多个交易所的 WebSocket 连接
 * - 自动重连（指数退避）
 * - 心跳保活
 * - 订阅管理
 */
export class WsConnectionManager extends EventEmitter<WsManagerEvents> {
  // ========================================================================
  // 私有属性
  // ========================================================================

  // 配置
  private readonly config: WsConfig;

  // 各交易所的 WebSocket 连接
  private connections: Map<ExchangeId, WebSocket | null> = new Map();

  // 连接信息
  private connectionInfo: Map<ExchangeId, WsConnectionInfo> = new Map();

  // 心跳定时器
  private heartbeatTimers: Map<ExchangeId, NodeJS.Timeout> = new Map();

  // 重连定时器
  private reconnectTimers: Map<ExchangeId, NodeJS.Timeout> = new Map();

  // 当前订阅（用于重连后恢复）
  // Map<exchange, Set<subscriptionMessage>>
  private subscriptions: Map<ExchangeId, Set<string>> = new Map();

  // 是否正在关闭
  private isShuttingDown: boolean = false;

  // ========================================================================
  // 构造函数
  // ========================================================================

  /**
   * 构造函数
   * @param config - WebSocket 配置
   */
  constructor(config: Partial<WsConfig> = {}) {
    // 初始化 EventEmitter
    super();

    // 合并默认配置
    this.config = {
      reconnectBaseDelay: config.reconnectBaseDelay ?? 1000,
      reconnectMaxDelay: config.reconnectMaxDelay ?? 30000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 100,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };

    // 初始化各交易所的连接状态
    for (const exchange of ['binance', 'bybit', 'okx'] as ExchangeId[]) {
      // 初始化连接为 null
      this.connections.set(exchange, null);

      // 初始化连接信息
      this.connectionInfo.set(exchange, {
        exchange,
        state: 'disconnected',
        url: EXCHANGE_ENDPOINTS[exchange].publicUrl,
        connectedAt: null,
        reconnectCount: 0,
        lastMessageAt: 0,
        latency: 0,
      });

      // 初始化订阅集合
      this.subscriptions.set(exchange, new Set());
    }
  }

  // ========================================================================
  // 连接管理
  // ========================================================================

  /**
   * 连接到指定交易所
   * @param exchange - 交易所 ID
   */
  async connect(exchange: ExchangeId): Promise<void> {
    // 获取端点配置
    const endpoint = EXCHANGE_ENDPOINTS[exchange];

    // 更新连接状态
    this.updateConnectionState(exchange, 'connecting');

    // 返回 Promise，等待连接成功或失败
    return new Promise((resolve, reject) => {
      try {
        // 创建 WebSocket 连接
        const ws = new WebSocket(endpoint.publicUrl, {
          // 启用压缩
          perMessageDeflate: false,
          // 设置最大消息大小（10MB）
          maxPayload: 10 * 1024 * 1024,
        });

        // 设置二进制类型
        ws.binaryType = 'arraybuffer';

        // 连接成功事件
        ws.on('open', () => {
          // 保存连接
          this.connections.set(exchange, ws);

          // 更新连接信息
          const info = this.connectionInfo.get(exchange)!;
          info.state = 'connected';
          info.connectedAt = Date.now();
          info.lastMessageAt = Date.now();

          // 启动心跳
          this.startHeartbeat(exchange);

          // 恢复订阅
          this.restoreSubscriptions(exchange);

          // 发出连接成功事件
          this.emit('connected', exchange);

          // 解析 Promise
          resolve();
        });

        // 收到消息事件
        ws.on('message', (data: Buffer | string) => {
          // 更新最后消息时间
          const info = this.connectionInfo.get(exchange)!;
          info.lastMessageAt = Date.now();

          // 转换为字符串
          const message = typeof data === 'string'
            ? data
            : data.toString('utf-8');

          // 检查是否为心跳响应
          if (this.isPongMessage(exchange, message)) {
            // 更新延迟
            this.updateLatency(exchange);
            return;
          }

          // 发出消息事件
          this.emit('message', exchange, message);
        });

        // 连接关闭事件
        ws.on('close', (code: number, reason: Buffer) => {
          // 清除连接
          this.connections.set(exchange, null);

          // 停止心跳
          this.stopHeartbeat(exchange);

          // 更新连接状态
          this.updateConnectionState(exchange, 'disconnected');

          // 获取关闭原因
          const closeReason = reason.toString() || `Code: ${code}`;

          // 发出断开连接事件
          this.emit('disconnected', exchange, closeReason);

          // 如果不是主动关闭，尝试重连
          if (!this.isShuttingDown) {
            this.scheduleReconnect(exchange);
          }
        });

        // 错误事件
        ws.on('error', (error: Error) => {
          // 发出错误事件
          this.emit('error', exchange, error);

          // 如果连接尚未建立，拒绝 Promise
          if (ws.readyState === WebSocket.CONNECTING) {
            reject(error);
          }
        });

        // 设置连接超时
        const timeout = setTimeout(() => {
          // 如果还在连接中，关闭并拒绝
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.close();
            reject(new Error(`Connection timeout for ${exchange}`));
          }
        }, 10000); // 10 秒超时

        // 连接成功后清除超时
        ws.once('open', () => {
          clearTimeout(timeout);
        });

      } catch (error) {
        // 连接失败
        reject(error);
      }
    });
  }

  /**
   * 断开指定交易所连接
   * @param exchange - 交易所 ID
   */
  disconnect(exchange: ExchangeId): void {
    // 获取连接
    const ws = this.connections.get(exchange);

    // 停止心跳
    this.stopHeartbeat(exchange);

    // 清除重连定时器
    this.clearReconnectTimer(exchange);

    // 关闭连接
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Normal closure');
    }

    // 清除连接
    this.connections.set(exchange, null);

    // 更新状态
    this.updateConnectionState(exchange, 'disconnected');
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    // 标记正在关闭
    this.isShuttingDown = true;

    // 断开所有交易所
    for (const exchange of this.connections.keys()) {
      this.disconnect(exchange);
    }
  }

  /**
   * 连接所有交易所
   */
  async connectAll(): Promise<void> {
    // 重置关闭标记
    this.isShuttingDown = false;

    // 并行连接所有交易所
    const exchanges: ExchangeId[] = ['binance', 'bybit', 'okx'];
    await Promise.all(exchanges.map(e => this.connect(e)));
  }

  // ========================================================================
  // 订阅管理
  // ========================================================================

  /**
   * 发送订阅消息
   * @param exchange - 交易所 ID
   * @param message - 订阅消息（JSON 字符串）
   */
  subscribe(exchange: ExchangeId, message: string): void {
    // 获取连接
    const ws = this.connections.get(exchange);

    // 保存订阅消息（用于重连恢复）
    this.subscriptions.get(exchange)!.add(message);

    // 如果已连接，发送订阅消息
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }

  /**
   * 发送取消订阅消息
   * @param exchange - 交易所 ID
   * @param subscribeMessage - 原订阅消息
   * @param unsubscribeMessage - 取消订阅消息
   */
  unsubscribe(
    exchange: ExchangeId,
    subscribeMessage: string,
    unsubscribeMessage: string
  ): void {
    // 获取连接
    const ws = this.connections.get(exchange);

    // 从保存的订阅中移除
    this.subscriptions.get(exchange)!.delete(subscribeMessage);

    // 如果已连接，发送取消订阅消息
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(unsubscribeMessage);
    }
  }

  /**
   * 恢复订阅（重连后调用）
   * @param exchange - 交易所 ID
   */
  private restoreSubscriptions(exchange: ExchangeId): void {
    // 获取连接
    const ws = this.connections.get(exchange);

    // 获取保存的订阅
    const subs = this.subscriptions.get(exchange)!;

    // 如果已连接且有订阅，重新发送
    if (ws && ws.readyState === WebSocket.OPEN && subs.size > 0) {
      // 延迟 100ms 发送，确保连接稳定
      setTimeout(() => {
        for (const message of subs) {
          ws.send(message);
        }
      }, 100);
    }
  }

  // ========================================================================
  // 心跳管理
  // ========================================================================

  /**
   * 启动心跳定时器
   * @param exchange - 交易所 ID
   */
  private startHeartbeat(exchange: ExchangeId): void {
    // 先停止现有心跳
    this.stopHeartbeat(exchange);

    // 获取端点配置
    const endpoint = EXCHANGE_ENDPOINTS[exchange];

    // 创建心跳定时器
    const timer = setInterval(() => {
      // 获取连接
      const ws = this.connections.get(exchange);

      // 检查连接状态
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      // Binance 使用原生 ping
      if (exchange === 'binance') {
        ws.ping();
        return;
      }

      // 其他交易所发送自定义 ping 消息
      const pingMsg = typeof endpoint.pingMessage === 'function'
        ? endpoint.pingMessage()
        : endpoint.pingMessage;

      if (pingMsg) {
        ws.send(pingMsg);
      }

      // 记录 ping 时间（用于计算延迟）
      const info = this.connectionInfo.get(exchange)!;
      (info as any)._lastPingTime = Date.now();

    }, this.config.heartbeatInterval);

    // 保存定时器
    this.heartbeatTimers.set(exchange, timer);
  }

  /**
   * 停止心跳定时器
   * @param exchange - 交易所 ID
   */
  private stopHeartbeat(exchange: ExchangeId): void {
    // 获取定时器
    const timer = this.heartbeatTimers.get(exchange);

    // 清除定时器
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(exchange);
    }
  }

  /**
   * 检查是否为 pong 消息
   * @param exchange - 交易所 ID
   * @param message - 消息内容
   */
  private isPongMessage(exchange: ExchangeId, message: string): boolean {
    // 获取端点配置
    const endpoint = EXCHANGE_ENDPOINTS[exchange];
    const pattern = endpoint.pongPattern;

    // 如果没有配置模式，返回 false
    if (!pattern) {
      return false;
    }

    // 字符串匹配或正则匹配
    if (typeof pattern === 'string') {
      return message.includes(pattern);
    } else {
      return pattern.test(message);
    }
  }

  /**
   * 更新延迟
   * @param exchange - 交易所 ID
   */
  private updateLatency(exchange: ExchangeId): void {
    // 获取连接信息
    const info = this.connectionInfo.get(exchange)!;

    // 计算延迟
    const pingTime = (info as any)._lastPingTime;
    if (pingTime) {
      info.latency = Date.now() - pingTime;
    }
  }

  // ========================================================================
  // 重连管理
  // ========================================================================

  /**
   * 安排重连
   * @param exchange - 交易所 ID
   */
  private scheduleReconnect(exchange: ExchangeId): void {
    // 如果正在关闭，不重连
    if (this.isShuttingDown) {
      return;
    }

    // 获取连接信息
    const info = this.connectionInfo.get(exchange)!;

    // 检查重连次数
    if (info.reconnectCount >= this.config.maxReconnectAttempts) {
      // 超过最大重连次数
      this.emit('error', exchange, new Error('Max reconnect attempts exceeded'));
      return;
    }

    // 增加重连计数
    info.reconnectCount++;

    // 更新状态
    this.updateConnectionState(exchange, 'reconnecting');

    // 发出重连事件
    this.emit('reconnecting', exchange, info.reconnectCount);

    // 计算指数退避延迟
    const delay = Math.min(
      this.config.reconnectBaseDelay * Math.pow(2, info.reconnectCount - 1),
      this.config.reconnectMaxDelay
    );

    // 添加随机抖动（0-1000ms）
    const jitter = Math.random() * 1000;
    const totalDelay = delay + jitter;

    // 清除之前的重连定时器
    this.clearReconnectTimer(exchange);

    // 创建新的重连定时器
    const timer = setTimeout(async () => {
      try {
        // 尝试重连
        await this.connect(exchange);

        // 重连成功，重置计数
        info.reconnectCount = 0;

      } catch (error) {
        // 重连失败，继续尝试
        this.scheduleReconnect(exchange);
      }
    }, totalDelay);

    // 保存定时器
    this.reconnectTimers.set(exchange, timer);
  }

  /**
   * 清除重连定时器
   * @param exchange - 交易所 ID
   */
  private clearReconnectTimer(exchange: ExchangeId): void {
    // 获取定时器
    const timer = this.reconnectTimers.get(exchange);

    // 清除定时器
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(exchange);
    }
  }

  // ========================================================================
  // 状态管理
  // ========================================================================

  /**
   * 更新连接状态
   * @param exchange - 交易所 ID
   * @param state - 新状态
   */
  private updateConnectionState(
    exchange: ExchangeId,
    state: WsConnectionState
  ): void {
    // 获取连接信息
    const info = this.connectionInfo.get(exchange)!;

    // 更新状态
    info.state = state;
  }

  /**
   * 获取连接信息
   * @param exchange - 交易所 ID
   */
  getConnectionInfo(exchange: ExchangeId): WsConnectionInfo {
    return this.connectionInfo.get(exchange)!;
  }

  /**
   * 获取所有连接信息
   */
  getAllConnectionInfo(): Map<ExchangeId, WsConnectionInfo> {
    return new Map(this.connectionInfo);
  }

  /**
   * 检查是否已连接
   * @param exchange - 交易所 ID
   */
  isConnected(exchange: ExchangeId): boolean {
    const ws = this.connections.get(exchange);
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }

  /**
   * 发送原始消息
   * @param exchange - 交易所 ID
   * @param message - 消息内容
   */
  send(exchange: ExchangeId, message: string): void {
    const ws = this.connections.get(exchange);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}
