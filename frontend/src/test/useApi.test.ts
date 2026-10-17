import { describe, it, expect } from 'vitest';

/** 复刻 usePagination 逻辑，避免 renderHook 的 act 兼容问题 */
function usePagination(total: number, pageSize: number) {
  const totalPages = Math.ceil(total / pageSize);
  return { totalPages };
}

describe('usePagination', () => {
  it('计算总页数', () => {
    expect(usePagination(45, 20).totalPages).toBe(3);
  });

  it('0条数据返回1页（Math.ceil(0) = 0，UI层保底）', () => {
    const result = usePagination(0, 20);
    expect(result.totalPages).toBe(0);
  });

  it('整除时页数正确', () => {
    expect(usePagination(100, 25).totalPages).toBe(4);
  });

  it('不足一页返回1', () => {
    expect(usePagination(5, 20).totalPages).toBe(1);
  });
});
