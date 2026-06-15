import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import ErrorBoundary from '../components/ErrorBoundary';

function renderToContainer(ui: React.ReactNode): HTMLDivElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => { root.render(ui); });
  return container;
}

function GoodChild() {
  return <div>正常内容</div>;
}

function BadChild() {
  throw new Error('测试错误');
}

describe('ErrorBoundary', () => {
  it('正常渲染子组件', () => {
    const container = renderToContainer(
      <ErrorBoundary><GoodChild /></ErrorBoundary>,
    );
    expect(container.textContent).toContain('正常内容');
    container.remove();
  });

  it('捕获错误显示 fallback', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = renderToContainer(
      <ErrorBoundary><BadChild /></ErrorBoundary>,
    );
    expect(container.textContent).toContain('页面加载出错了');
    expect(container.textContent).toContain('测试错误');
    consoleSpy.mockRestore();
    container.remove();
  });

  it('显示重试按钮', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = renderToContainer(
      <ErrorBoundary><BadChild /></ErrorBoundary>,
    );
    expect(container.textContent).toContain('重试');
    consoleSpy.mockRestore();
    container.remove();
  });
});
