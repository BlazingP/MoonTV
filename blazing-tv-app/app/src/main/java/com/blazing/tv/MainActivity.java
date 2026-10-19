package com.blazing.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebBackForwardList;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

/** 全屏 WebView 外壳：加载局域网 MoonTV，并适配电视遥控器。 */
public class MainActivity extends Activity implements TvBridge.Host {
    private static final String ERROR_PAGE = "file:///android_asset/error.html";
    private static final String NAV_SCRIPT_ASSET = "tv-nav.js";
    private static final long EXIT_CONFIRM_WINDOW_MS = 2000;
    private static final long RENDERER_RECREATE_MIN_INTERVAL_MS = 10_000;
    /** 跨 recreate 保留，用于识别渲染进程反复崩溃。 */
    private static long lastRendererRecreateAt;

    private FrameLayout root;
    private WebView webView;
    private ServerPrefs prefs;
    private String navScript = "";
    private final ShellChromeClient chromeClient = new ShellChromeClient();

    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private long lastBackPressAt;
    private boolean backLongPressed;
    private boolean backDownSeen;
    private boolean clearHistoryOnNextLoad;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new ServerPrefs(this);
        navScript = readAsset(NAV_SCRIPT_ASSET);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        configureWebView();
        // 不恢复 WebView 状态：播放页切集会不断 pushState，保存的历史可能超出 Bundle 上限
        webView.loadUrl(prefs.getServer());
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setOffscreenPreRaster(true);
        s.setUserAgentString(s.getUserAgentString() + " BlazingTV/" + BuildConfig.VERSION_NAME);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.BLACK);
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();
        webView.addJavascriptInterface(new TvBridge(this), "TvBridge");
        webView.setWebViewClient(new ShellWebViewClient());
        webView.setWebChromeClient(chromeClient);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        installDocumentStartScript();
    }

    /** 新版 WebView 支持在文档开始时注入，避免页面加载完成前按键无人接管。 */
    private void installDocumentStartScript() {
        if (navScript.isEmpty()
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            return;
        }
        Set<String> origins = new HashSet<>();
        origins.add("*");
        WebViewCompat.addDocumentStartJavaScript(webView, navScript, origins);
    }

    // ---------------------------------------------------------------- WebView 回调

    private final class ShellWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // 子框架（about:blank、blob: 等）交给 WebView 自己处理
            if (!request.isForMainFrame()) return false;
            String scheme = request.getUrl().getScheme();
            // 主框架只在应用内打开网页；其他协议（intent:// 等）直接忽略
            return !("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            // 整页跳转时旧页面的视频不会再上报暂停，这里先取消常亮
            onPlayingChanged(false);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            // SPA 路由切换（如从播放页返回首页）后重新确认是否还在播放
            view.evaluateJavascript("window.__tvReportPlaying && window.__tvReportPlaying()", null);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            // 旧版 WebView 的兜底注入；脚本自带防重复安装
            if (!navScript.isEmpty()) view.evaluateJavascript(navScript, null);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!navScript.isEmpty()) view.evaluateJavascript(navScript, null);
            if (clearHistoryOnNextLoad && url != null && !url.startsWith(ERROR_PAGE)) {
                // 换服务器后，等新首页加载完再清历史，避免返回键回到旧服务器
                view.clearHistory();
                clearHistoryOnNextLoad = false;
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 渲染进程被系统回收（长时间播放可能 OOM）时重建页面，而不是让整个应用崩溃
            root.removeView(view);
            view.destroy();
            webView = null;
            if (isFinishing() || isDestroyed()) return true;
            long now = SystemClock.uptimeMillis();
            if (now - lastRendererRecreateAt < RENDERER_RECREATE_MIN_INTERVAL_MS) {
                finish(); // 短时间内反复崩溃，避免无限黑屏重建
            } else {
                lastRendererRecreateAt = now;
                recreate();
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !request.getUrl().toString().startsWith(ERROR_PAGE)) {
                showErrorPage(String.valueOf(error.getDescription()));
            }
        }
    }

    private final class ShellChromeClient extends WebChromeClient {
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setVisibility(View.INVISIBLE);
            view.requestFocus();
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            webView.setVisibility(View.VISIBLE);
            webView.requestFocus();
            if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    private void showErrorPage(String reason) {
        String url = ERROR_PAGE
                + "?server=" + Uri.encode(prefs.getServer())
                + "&reason=" + Uri.encode(reason == null ? "" : reason);
        webView.loadUrl(url);
    }

    // ---------------------------------------------------------------- 遥控器按键

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (webView == null) return true; // 渲染进程崩溃后、重建完成前，忽略按键
        if (!isShellKey(keyCode)) return super.dispatchKeyEvent(event);
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            handleBackKeyEvent(event);
        } else if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            handleRemoteKey(keyCode);
        }
        // 抬起事件也要吞掉，否则系统会把 BACK 抬起当作 onBackPressed 直接退出
        return true;
    }

    /** 短按返回：后退；长按返回：打开菜单（多数电视遥控器没有可用的 MENU 键）。 */
    private void handleBackKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if (event.getRepeatCount() == 0) {
                backLongPressed = false;
                backDownSeen = true;
            } else if (event.getRepeatCount() == 1) {
                backLongPressed = true;
                showMenu();
            }
            return;
        }
        if (event.getAction() == KeyEvent.ACTION_UP) {
            // 只处理本窗口收到过按下的抬起，避免输入法/对话框漏下来的孤立抬起触发后退
            if (backDownSeen && !backLongPressed && !event.isCanceled()) handleBack();
            backLongPressed = false;
            backDownSeen = false;
        }
    }

    private static boolean isShellKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_MENU:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return true;
            default:
                return false;
        }
    }

    /** 处理需要原生介入的按键。 */
    private void handleRemoteKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MENU:
                showMenu();
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                runMediaAction("play");
                break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                runMediaAction("pause");
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                runMediaAction("toggle");
                break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                runMediaAction("forward");
                break;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                runMediaAction("rewind");
                break;
            default:
                break;
        }
    }

    private void runMediaAction(String action) {
        webView.evaluateJavascript(
                "window.__tvMedia && window.__tvMedia('" + action + "')", null);
    }

    private void handleBack() {
        if (customView != null) {
            webView.evaluateJavascript(
                    "document.fullscreenElement && document.exitFullscreen()", null);
            chromeClient.onHideCustomView();
            return;
        }
        webView.evaluateJavascript("window.__tvBack ? window.__tvBack() : false", handled -> {
            if ("true".equals(handled)) return;
            // 错误页当作根页面：再后退只会重新加载连不上的地址，又回到错误页
            if (isOnErrorPage() || !goBackToPreviousPage()) confirmExit();
        });
    }

    /**
     * 后退到上一个“不同页面”：MoonTV 播放页切集时会 pushState，
     * 同一路径的历史记录和本地错误页都跳过，否则要按好几次返回才能离开播放页。
     */
    private boolean goBackToPreviousPage() {
        WebBackForwardList history = webView.copyBackForwardList();
        int current = history.getCurrentIndex();
        if (current <= 0 || history.getCurrentItem() == null) return false;
        String currentPage = pageKey(history.getCurrentItem().getUrl());
        for (int i = current - 1; i >= 0; i--) {
            String url = history.getItemAtIndex(i).getUrl();
            if (url.startsWith(ERROR_PAGE) || pageKey(url).equals(currentPage)) continue;
            webView.goBackOrForward(i - current);
            return true;
        }
        return false;
    }

    /** 去掉查询参数后的页面标识：协议 + 主机 + 端口 + 路径。 */
    private static String pageKey(String url) {
        Uri uri = Uri.parse(url);
        return uri.getScheme() + "://" + uri.getHost() + ":" + uri.getPort() + uri.getPath();
    }

    private void confirmExit() {
        long now = SystemClock.uptimeMillis();
        if (now - lastBackPressAt < EXIT_CONFIRM_WINDOW_MS) {
            finish();
            return;
        }
        lastBackPressAt = now;
        Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
    }

    private void showMenu() {
        String[] items = {
                getString(R.string.menu_reload),
                getString(R.string.menu_home),
                getString(R.string.menu_server)
        };
        new AlertDialog.Builder(this)
                .setTitle(R.string.menu_title)
                .setItems(items, (d, which) -> {
                    if (which == 0) webView.reload();
                    else if (which == 1) webView.loadUrl(prefs.getServer());
                    else showServerDialog();
                })
                .show();
    }

    private void showServerDialog() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(prefs.getServer());
        input.setHint(R.string.server_hint);
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle(R.string.menu_server)
                .setView(input)
                .setPositiveButton(R.string.ok, (d, w) -> applyServer(input.getText().toString()))
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    private void applyServer(String raw) {
        String url = ServerPrefs.normalize(raw);
        if (url == null) {
            Toast.makeText(this, R.string.server_invalid, Toast.LENGTH_LONG).show();
            return;
        }
        prefs.setServer(url);
        clearHistoryOnNextLoad = true;
        webView.loadUrl(url);
    }

    // ---------------------------------------------------------------- TvBridge.Host

    @Override
    public void onShowKeyboard() {
        runOnUiThread(() -> {
            if (webView == null) return;
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            webView.requestFocus();
            if (imm != null) imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
        });
    }

    @Override
    public void onPlayingChanged(boolean playing) {
        runOnUiThread(() -> {
            if (playing) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @Override
    public void onRetry() {
        runOnUiThread(() -> {
            if (isOnErrorPage()) webView.loadUrl(prefs.getServer());
        });
    }

    @Override
    public void onSetServer(String raw) {
        runOnUiThread(() -> {
            if (isOnErrorPage()) applyServer(raw);
        });
    }

    /** 只有本地错误页可以调用 retry / setServer，防止远程页面改写服务器地址。 */
    private boolean isOnErrorPage() {
        String url = webView == null ? null : webView.getUrl();
        return url != null && url.startsWith(ERROR_PAGE);
    }

    // ---------------------------------------------------------------- 生命周期

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onStop() {
        // WebView.onPause 不保证停止媒体；完全看不见（按 Home、进屏保）时才暂停，
        // 侧边快捷设置栏这类浮层只触发 onPause，不打断播放
        if (webView != null) webView.evaluateJavascript("window.__tvMedia && window.__tvMedia('pause')", null);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            android.util.Log.e("BlazingTV", "读取 " + name + " 失败", e);
            return "";
        }
    }
}
