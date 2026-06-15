import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** 全局错误边界，防止组件崩溃导致白屏 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="empty" role="alert">
            <p>页面加载出错了</p>
            <p className="text-sm text-gray">{this.state.error?.message}</p>
            <button className="btn btn-primary" onClick={this.handleRetry} style={{ marginTop: 12 }}>
              重试
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
