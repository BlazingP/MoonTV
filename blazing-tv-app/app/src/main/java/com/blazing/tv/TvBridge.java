package com.blazing.tv;

import android.webkit.JavascriptInterface;

/**
 * 暴露给网页的 window.TvBridge。
 * 所有方法都在 JavaBridge 线程被调用，回调交给 Host 切回主线程处理。
 */
final class TvBridge {
    interface Host {
        void onShowKeyboard();
        void onPlayingChanged(boolean playing);
        /** 仅本地错误页允许调用，Host 负责校验当前页面来源。 */
        void onRetry();
        void onSetServer(String url);
    }

    private final Host host;

    TvBridge(Host host) {
        this.host = host;
    }

    @JavascriptInterface
    public void showKeyboard() {
        host.onShowKeyboard();
    }

    @JavascriptInterface
    public void setPlaying(boolean playing) {
        host.onPlayingChanged(playing);
    }

    @JavascriptInterface
    public void retry() {
        host.onRetry();
    }

    @JavascriptInterface
    public void setServer(String url) {
        host.onSetServer(url);
    }
}
