import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * 描画中の例外で画面が真っ白にならないよう、エラー内容と再読み込みボタンを表示する。
 * ノートは変更のたびに自動保存しているため、再読み込みしても保存済みの内容は失われない。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-[72ch] max-w-full">
          <p className="text-bright">[!] 表示中にエラーが発生しました</p>
          <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap border border-line p-2 text-dim">
            {error.message || String(error)}
          </pre>
          <p className="mt-2 text-dim">
            資料またはノートファイル (.notes.json) の内容が原因の可能性があります。保存済みのノートは失われていません。
          </p>
          <p className="mt-4">
            <button onClick={() => window.location.reload()} className="btn">
              再読み込み
            </button>
          </p>
        </div>
      </div>
    );
  }
}
