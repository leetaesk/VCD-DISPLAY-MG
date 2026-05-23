import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 페이지 단위 ErrorBoundary.
 *
 * Layout 안에서 <Outlet />을 감싸서, 페이지 컴포넌트에서 던진 에러
 * (WebGL 컨텍스트 손실, MediaPipe WASM 로드 실패, 카메라 권한 거부 등)를
 * 흰 화면 대신 fallback UI로 노출.
 *
 * - React 19에도 hook 기반 ErrorBoundary는 없음 — class 컴포넌트 필수.
 * - StrictMode dev에서는 에러를 두 번 throw하지만 (의도된 동작) 실제 사용자에게는
 *   한 번만 보임.
 */
interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 콘솔에는 항상 남김 — DevTools 없이도 보이도록.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <DefaultFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="m-6 max-w-2xl rounded-md border border-err/50 bg-err/5 p-5 text-text">
      <div className="mb-2 font-semibold text-err">문제가 발생했습니다</div>
      <p className="mb-3 text-sm text-text-dim">
        페이지 렌더링 중 오류로 표시가 중단됐습니다. 카메라 권한, WebGL 지원, 네트워크 상태를 확인해보세요.
      </p>
      <pre className="mb-3 overflow-auto rounded bg-bg-elev-2 p-3 font-mono text-xs">
        {error.message}
      </pre>
      <button
        type="button"
        onClick={onReset}
        className="rounded-md border border-line bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent"
      >
        다시 시도
      </button>
    </div>
  );
}

export default ErrorBoundary;
