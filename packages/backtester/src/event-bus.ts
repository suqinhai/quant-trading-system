// ============================================================================
// 高性能事件总线
// 使用优先级队列实现毫秒级事件排序
// 支持批量事件推送和消费，优化内存分配
// ============================================================================

import {
  type BacktestEvent,
  type Timestamp,
} from './types.js';

// ============================================================================
// 事件比较函数类型
// ============================================================================

// 事件比较器（用于排序，返回负数表示 a 优先于 b）
type EventComparator = (a: BacktestEvent, b: BacktestEvent) => number;

// ============================================================================
// 最小堆实现（优先级队列核心）
// ============================================================================

/**
 * 泛型最小堆
 * 使用数组实现二叉堆，支持 O(log n) 插入和弹出
 * 针对大数据量优化，预分配数组空间
 */
class MinHeap<T> {
  // 堆数组（索引 0 不使用，从 1 开始便于计算父子关系）
  private heap: (T | undefined)[];

  // 当前堆大小
  private _size: number = 0;

  // 比较函数（返回负数表示 a < b）
  private compare: (a: T, b: T) => number;

  /**
   * 构造函数
   * @param compare - 比较函数
   * @param initialCapacity - 初始容量（预分配空间）
   */
  constructor(compare: (a: T, b: T) => number, initialCapacity: number = 10000) {
    // 保存比较函数
    this.compare = compare;
    // 预分配数组空间（+1 因为索引 0 不使用）
    this.heap = new Array(initialCapacity + 1);
  }

  /**
   * 获取堆大小
   */
  get size(): number {
    return this._size;
  }

  /**
   * 检查堆是否为空
   */
  isEmpty(): boolean {
    return this._size === 0;
  }

  /**
   * 查看堆顶元素（不移除）
   */
  peek(): T | undefined {
    // 返回索引 1 的元素（堆顶）
    return this._size > 0 ? this.heap[1] : undefined;
  }

  /**
   * 插入元素
   * @param value - 要插入的值
   */
  push(value: T): void {
    // 增加大小
    this._size++;

    // 检查是否需要扩容
    if (this._size >= this.heap.length) {
      // 扩容为原来的 2 倍
      this.grow();
    }

    // 将新元素放在末尾
    this.heap[this._size] = value;

    // 上浮调整堆
    this.siftUp(this._size);
  }

  /**
   * 批量插入元素（优化版本）
   * @param values - 要插入的值数组
   */
  pushAll(values: T[]): void {
    // 遍历所有值
    for (const value of values) {
      // 逐个插入
      this.push(value);
    }
  }

  /**
   * 弹出堆顶元素
   */
  pop(): T | undefined {
    // 空堆返回 undefined
    if (this._size === 0) {
      return undefined;
    }

    // 保存堆顶元素
    const top = this.heap[1];

    // 将末尾元素移到堆顶
    this.heap[1] = this.heap[this._size];

    // 清除末尾引用（帮助 GC）
    this.heap[this._size] = undefined;

    // 减少大小
    this._size--;

    // 下沉调整堆（如果堆不为空）
    if (this._size > 0) {
      this.siftDown(1);
    }

    // 返回原堆顶
    return top;
  }

  /**
   * 清空堆
   */
  clear(): void {
    // 清除所有引用
    for (let i = 1; i <= this._size; i++) {
      this.heap[i] = undefined;
    }
    // 重置大小
    this._size = 0;
  }

  /**
   * 上浮操作（插入后调整）
   * @param index - 起始索引
   */
  private siftUp(index: number): void {
    // 保存当前元素
    const value = this.heap[index]!;

    // 循环直到到达堆顶
    while (index > 1) {
      // 计算父节点索引
      const parentIndex = Math.floor(index / 2);
      // 获取父节点值
      const parent = this.heap[parentIndex]!;

      // 如果当前值 >= 父节点值，停止
      if (this.compare(value, parent) >= 0) {
        break;
      }

      // 将父节点下移
      this.heap[index] = parent;
      // 继续向上
      index = parentIndex;
    }

    // 将值放到最终位置
    this.heap[index] = value;
  }

  /**
   * 下沉操作（弹出后调整）
   * @param index - 起始索引
   */
  private siftDown(index: number): void {
    // 保存当前元素
    const value = this.heap[index]!;
    // 计算最后一个非叶子节点的索引
    const halfSize = Math.floor(this._size / 2);

    // 循环直到到达叶子节点
    while (index <= halfSize) {
      // 计算左子节点索引
      let childIndex = index * 2;
      // 获取左子节点值
      let child = this.heap[childIndex]!;

      // 计算右子节点索引
      const rightIndex = childIndex + 1;

      // 如果右子节点存在且更小，选择右子节点
      if (rightIndex <= this._size) {
        const right = this.heap[rightIndex]!;
        if (this.compare(right, child) < 0) {
          childIndex = rightIndex;
          child = right;
        }
      }

      // 如果当前值 <= 最小子节点值，停止
      if (this.compare(value, child) <= 0) {
        break;
      }

      // 将子节点上移
      this.heap[index] = child;
      // 继续向下
      index = childIndex;
    }

    // 将值放到最终位置
    this.heap[index] = value;
  }

  /**
   * 扩容数组
   */
  private grow(): void {
    // 创建新数组（2 倍大小）
    const newCapacity = this.heap.length * 2;
    const newHeap = new Array(newCapacity);

    // 复制现有元素
    for (let i = 0; i <= this._size; i++) {
      newHeap[i] = this.heap[i];
    }

    // 替换数组
    this.heap = newHeap;
  }
}

// ============================================================================
// 事件优先级队列
// ============================================================================

/**
 * 事件优先级队列
 * 按时间戳排序的事件队列，支持高效的插入和弹出
 */
export class EventPriorityQueue {
  // 内部最小堆
  private heap: MinHeap<BacktestEvent>;

  // 事件计数器（用于统计）
  private eventCount: number = 0;

  /**
   * 构造函数
   * @param initialCapacity - 初始容量
   */
  constructor(initialCapacity: number = 100000) {
    // 创建最小堆，使用时间戳比较
    this.heap = new MinHeap<BacktestEvent>(
      // 比较函数：按时间戳升序排列
      (a, b) => a.timestamp - b.timestamp,
      // 初始容量
      initialCapacity
    );
  }

  /**
   * 获取队列大小
   */
  get size(): number {
    return this.heap.size;
  }

  /**
   * 获取已处理的事件总数
   */
  get totalEvents(): number {
    return this.eventCount;
  }

  /**
   * 检查队列是否为空
   */
  isEmpty(): boolean {
    return this.heap.isEmpty();
  }

  /**
   * 查看队首事件（不移除）
   */
  peek(): BacktestEvent | undefined {
    return this.heap.peek();
  }

  /**
   * 推送单个事件
   * @param event - 事件
   */
  push(event: BacktestEvent): void {
    // 插入堆
    this.heap.push(event);
  }

  /**
   * 批量推送事件（优化版本）
   * @param events - 事件数组
   */
  pushAll(events: BacktestEvent[]): void {
    // 批量插入
    this.heap.pushAll(events);
  }

  /**
   * 弹出队首事件
   */
  pop(): BacktestEvent | undefined {
    // 弹出堆顶
    const event = this.heap.pop();

    // 如果有事件，增加计数
    if (event) {
      this.eventCount++;
    }

    return event;
  }

  /**
   * 弹出所有时间戳 <= 指定时间的事件
   * @param timestamp - 截止时间戳
   * @returns 事件数组
   */
  popUntil(timestamp: Timestamp): BacktestEvent[] {
    // 结果数组
    const events: BacktestEvent[] = [];

    // 循环弹出直到超过时间戳
    while (!this.heap.isEmpty()) {
      // 查看队首
      const event = this.heap.peek()!;

      // 如果超过时间戳，停止
      if (event.timestamp > timestamp) {
        break;
      }

      // 弹出并添加到结果
      events.push(this.heap.pop()!);
      this.eventCount++;
    }

    return events;
  }

  /**
   * 弹出指定数量的事件
   * @param count - 数量
   * @returns 事件数组
   */
  popBatch(count: number): BacktestEvent[] {
    // 结果数组
    const events: BacktestEvent[] = [];

    // 循环弹出指定数量
    for (let i = 0; i < count && !this.heap.isEmpty(); i++) {
      events.push(this.heap.pop()!);
      this.eventCount++;
    }

    return events;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.heap.clear();
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.eventCount = 0;
  }
}

// ============================================================================
// 事件总线（核心组件）
// ============================================================================

// 事件处理器类型
type EventHandler<T extends BacktestEvent = BacktestEvent> = (event: T) => void | Promise<void>;

// 事件类型到处理器的映射
type EventHandlerMap = {
  [K in BacktestEvent['type']]?: EventHandler<Extract<BacktestEvent, { type: K }>>[];
};

/**
 * 高性能事件总线
 * 支持事件订阅、优先级队列、批量处理
 */
export class EventBus {
  // 事件处理器映射
  private handlers: EventHandlerMap = {};

  // 通用处理器（处理所有事件）
  private wildcardHandlers: EventHandler[] = [];

  // 事件优先级队列
  private queue: EventPriorityQueue;

  // 当前处理时间戳
  private _currentTime: Timestamp = 0;

  // 是否正在处理
  private processing: boolean = false;

  // 是否应该停止
  private shouldStop: boolean = false;

  // 处理统计
  private stats = {
    // 已处理事件数
    eventsProcessed: 0,
    // 处理开始时间
    startTime: 0,
    // 处理结束时间
    endTime: 0,
  };

  /**
   * 构造函数
   * @param queueCapacity - 队列初始容量
   */
  constructor(queueCapacity: number = 100000) {
    // 创建事件优先级队列
    this.queue = new EventPriorityQueue(queueCapacity);
  }

  /**
   * 获取当前时间
   */
  get currentTime(): Timestamp {
    return this._currentTime;
  }

  /**
   * 获取队列大小
   */
  get queueSize(): number {
    return this.queue.size;
  }

  /**
   * 获取处理统计
   */
  getStats() {
    // 计算处理时间
    const processingTime = this.stats.endTime - this.stats.startTime;
    // 计算每秒事件数
    const eventsPerSecond = processingTime > 0
      ? (this.stats.eventsProcessed / processingTime) * 1000
      : 0;

    return {
      eventsProcessed: this.stats.eventsProcessed,
      processingTime,
      eventsPerSecond,
    };
  }

  /**
   * 订阅特定类型的事件
   * @param type - 事件类型
   * @param handler - 处理器函数
   */
  on<T extends BacktestEvent['type']>(
    type: T,
    handler: EventHandler<Extract<BacktestEvent, { type: T }>>
  ): void {
    // 初始化处理器数组
    if (!this.handlers[type]) {
      this.handlers[type] = [];
    }

    // 添加处理器
    (this.handlers[type] as EventHandler[]).push(handler as EventHandler);
  }

  /**
   * 订阅所有事件
   * @param handler - 处理器函数
   */
  onAll(handler: EventHandler): void {
    // 添加到通用处理器列表
    this.wildcardHandlers.push(handler);
  }

  /**
   * 取消订阅
   * @param type - 事件类型
   * @param handler - 处理器函数
   */
  off<T extends BacktestEvent['type']>(
    type: T,
    handler: EventHandler<Extract<BacktestEvent, { type: T }>>
  ): void {
    // 获取处理器数组
    const handlers = this.handlers[type];
    if (!handlers) return;

    // 查找并移除
    const index = handlers.indexOf(handler as EventHandler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * 取消订阅所有事件处理器
   * @param handler - 处理器函数
   */
  offAll(handler: EventHandler): void {
    // 查找并移除
    const index = this.wildcardHandlers.indexOf(handler);
    if (index !== -1) {
      this.wildcardHandlers.splice(index, 1);
    }
  }

  /**
   * 发布事件到队列
   * @param event - 事件
   */
  emit(event: BacktestEvent): void {
    // 推送到优先级队列
    this.queue.push(event);
  }

  /**
   * 批量发布事件
   * @param events - 事件数组
   */
  emitAll(events: BacktestEvent[]): void {
    // 批量推送
    this.queue.pushAll(events);
  }

  /**
   * 立即处理事件（不入队列）
   * @param event - 事件
   */
  async dispatch(event: BacktestEvent): Promise<void> {
    // 更新当前时间
    this._currentTime = event.timestamp;

    // 获取特定类型的处理器
    const handlers = this.handlers[event.type] as EventHandler[] | undefined;

    // 调用特定类型处理器
    if (handlers) {
      for (const handler of handlers) {
        await handler(event);
      }
    }

    // 调用通用处理器
    for (const handler of this.wildcardHandlers) {
      await handler(event);
    }
  }

  /**
   * 同步处理事件（不入队列，无 await）
   * 用于高性能场景，处理器必须是同步的
   * @param event - 事件
   */
  dispatchSync(event: BacktestEvent): void {
    // 更新当前时间
    this._currentTime = event.timestamp;

    // 获取特定类型的处理器
    const handlers = this.handlers[event.type] as EventHandler[] | undefined;

    // 调用特定类型处理器
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    // 调用通用处理器
    for (const handler of this.wildcardHandlers) {
      handler(event);
    }
  }

  /**
   * 处理队列中的所有事件
   * @param onProgress - 进度回调（可选）
   */
  async processAll(
    onProgress?: (processed: number, remaining: number) => void
  ): Promise<void> {
    // 如果已在处理，跳过
    if (this.processing) {
      return;
    }

    // 标记开始处理
    this.processing = true;
    this.shouldStop = false;
    this.stats.startTime = Date.now();
    this.stats.eventsProcessed = 0;

    try {
      // 循环处理直到队列为空或停止
      while (!this.queue.isEmpty() && !this.shouldStop) {
        // 弹出事件
        const event = this.queue.pop()!;

        // 分发事件
        await this.dispatch(event);

        // 更新统计
        this.stats.eventsProcessed++;

        // 进度回调（每 10000 个事件调用一次）
        if (onProgress && this.stats.eventsProcessed % 10000 === 0) {
          onProgress(this.stats.eventsProcessed, this.queue.size);
        }
      }

    } finally {
      // 记录结束时间
      this.stats.endTime = Date.now();
      // 标记处理完成
      this.processing = false;
    }
  }

  /**
   * 同步处理所有事件（高性能版本）
   * 处理器必须是同步的
   * @param onProgress - 进度回调（可选）
   */
  processAllSync(
    onProgress?: (processed: number, remaining: number) => void
  ): void {
    // 如果已在处理，跳过
    if (this.processing) {
      return;
    }

    // 标记开始处理
    this.processing = true;
    this.shouldStop = false;
    this.stats.startTime = Date.now();
    this.stats.eventsProcessed = 0;

    try {
      // 循环处理直到队列为空或停止
      while (!this.queue.isEmpty() && !this.shouldStop) {
        // 弹出事件
        const event = this.queue.pop()!;

        // 同步分发事件
        this.dispatchSync(event);

        // 更新统计
        this.stats.eventsProcessed++;

        // 进度回调（每 100000 个事件调用一次，减少开销）
        if (onProgress && this.stats.eventsProcessed % 100000 === 0) {
          onProgress(this.stats.eventsProcessed, this.queue.size);
        }
      }

    } finally {
      // 记录结束时间
      this.stats.endTime = Date.now();
      // 标记处理完成
      this.processing = false;
    }
  }

  /**
   * 处理到指定时间戳
   * @param timestamp - 目标时间戳
   */
  async processUntil(timestamp: Timestamp): Promise<void> {
    // 如果已在处理，跳过
    if (this.processing) {
      return;
    }

    // 标记开始处理
    this.processing = true;

    try {
      // 弹出指定时间之前的所有事件
      const events = this.queue.popUntil(timestamp);

      // 依次处理
      for (const event of events) {
        if (this.shouldStop) break;
        await this.dispatch(event);
        this.stats.eventsProcessed++;
      }

    } finally {
      // 标记处理完成
      this.processing = false;
    }
  }

  /**
   * 停止处理
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * 清空队列和处理器
   */
  clear(): void {
    // 清空队列
    this.queue.clear();
    // 清空处理器
    this.handlers = {};
    this.wildcardHandlers = [];
    // 重置时间
    this._currentTime = 0;
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      eventsProcessed: 0,
      startTime: 0,
      endTime: 0,
    };
    this.queue.resetStats();
  }
}

// ============================================================================
// 导出默认实例工厂
// ============================================================================

/**
 * 创建事件总线实例
 * @param queueCapacity - 队列初始容量
 */
export function createEventBus(queueCapacity?: number): EventBus {
  return new EventBus(queueCapacity);
}
