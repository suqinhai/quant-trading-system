// ============================================================================
// 事件队列实现
// 基于优先级的事件队列，按时间戳排序
// ============================================================================

import type { BacktestEvent, IEventQueue } from './types.js';

// ============================================================================
// 优先级队列实现
// ============================================================================

/**
 * 事件队列
 *
 * 使用最小堆实现，按时间戳排序
 * 确保事件按正确的时间顺序处理
 */
export class EventQueue implements IEventQueue {
  // 使用数组存储事件（堆结构）
  private heap: BacktestEvent[] = [];

  /**
   * 添加事件到队列
   * @param event - 要添加的事件
   */
  public push(event: BacktestEvent): void {
    // 添加到数组末尾
    this.heap.push(event);

    // 上浮调整堆
    this.bubbleUp(this.heap.length - 1);
  }

  /**
   * 批量添加事件
   * @param events - 事件数组
   */
  public pushBatch(events: BacktestEvent[]): void {
    for (const event of events) {
      this.push(event);
    }
  }

  /**
   * 获取并移除下一个事件
   * @returns 时间戳最小的事件，如果队列为空则返回 undefined
   */
  public pop(): BacktestEvent | undefined {
    // 空队列
    if (this.heap.length === 0) {
      return undefined;
    }

    // 只有一个元素
    if (this.heap.length === 1) {
      return this.heap.pop();
    }

    // 保存堆顶元素
    const min = this.heap[0];

    // 将最后一个元素移到堆顶
    this.heap[0] = this.heap.pop()!;

    // 下沉调整堆
    this.bubbleDown(0);

    return min;
  }

  /**
   * 查看下一个事件（不移除）
   * @returns 时间戳最小的事件
   */
  public peek(): BacktestEvent | undefined {
    return this.heap[0];
  }

  /**
   * 检查队列是否为空
   */
  public isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * 获取队列大小
   */
  public size(): number {
    return this.heap.length;
  }

  /**
   * 清空队列
   */
  public clear(): void {
    this.heap = [];
  }

  /**
   * 上浮操作
   * 将新插入的元素调整到正确位置
   */
  private bubbleUp(index: number): void {
    while (index > 0) {
      // 计算父节点索引
      const parentIndex = Math.floor((index - 1) / 2);

      // 如果当前节点的时间戳大于等于父节点，停止上浮
      if (this.heap[index]!.timestamp >= this.heap[parentIndex]!.timestamp) {
        break;
      }

      // 交换当前节点和父节点
      this.swap(index, parentIndex);

      // 继续向上检查
      index = parentIndex;
    }
  }

  /**
   * 下沉操作
   * 将堆顶元素调整到正确位置
   */
  private bubbleDown(index: number): void {
    const length = this.heap.length;

    while (true) {
      // 计算左右子节点索引
      const leftChild = 2 * index + 1;
      const rightChild = 2 * index + 2;

      // 找出最小的节点
      let smallest = index;

      // 比较左子节点
      if (
        leftChild < length &&
        this.heap[leftChild]!.timestamp < this.heap[smallest]!.timestamp
      ) {
        smallest = leftChild;
      }

      // 比较右子节点
      if (
        rightChild < length &&
        this.heap[rightChild]!.timestamp < this.heap[smallest]!.timestamp
      ) {
        smallest = rightChild;
      }

      // 如果当前节点已经是最小的，停止下沉
      if (smallest === index) {
        break;
      }

      // 交换当前节点和最小子节点
      this.swap(index, smallest);

      // 继续向下检查
      index = smallest;
    }
  }

  /**
   * 交换两个位置的元素
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i]!;
    this.heap[i] = this.heap[j]!;
    this.heap[j] = temp;
  }

  /**
   * 获取所有事件（调试用）
   */
  public toArray(): BacktestEvent[] {
    // 返回排序后的副本
    return [...this.heap].sort((a, b) => a.timestamp - b.timestamp);
  }
}
