package io.github.alexbeatsz.webobsidian;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** Native host only: existing packaged application owns all note behavior. */
public final class MainActivity extends Activity {
    private WebView web;
    private String localOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private boolean storagePending;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Keep WebView above system bars and resize for the IME, including target35.
        getWindow().setDecorFitsSystemWindows(true);
        showLoading("正在打开本地笔记库…");
        RuntimeHost.start(this);
        new Thread(() -> {
            try {
                String origin = RuntimeHost.awaitReady();
                handler.post(() -> { if (!isFinishing() && !isDestroyed()) openWorkspace(origin); });
            } catch (Exception error) { handler.post(() -> showFailure(error.toString())); }
        }, "WebObsidian-Ready").start();
    }

    private void showLoading(String text) {
        TextView label = new TextView(this); label.setText(text); label.setGravity(Gravity.CENTER); label.setTextSize(16);
        setContentView(label);
    }

    private void showFailure(String message) {
        if (isFinishing() || isDestroyed()) return;
        showLoading("本地笔记库无法启动\n\n" + message);
    }

    private void openWorkspace(String origin) {
        localOrigin = origin;
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        web.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            // Reserve only a short middle segment; system Back remains available elsewhere.
            int edge = Math.round(28 * getResources().getDisplayMetrics().density);
            int half = Math.round(100 * getResources().getDisplayMetrics().density);
            int middle = view.getHeight() / 2;
            view.setSystemGestureExclusionRects(java.util.Arrays.asList(
                new android.graphics.Rect(0, Math.max(0, middle - half), edge, Math.min(view.getHeight(), middle + half)),
                new android.graphics.Rect(view.getWidth() - edge, Math.max(0, middle - half), view.getWidth(), Math.min(view.getHeight(), middle + half))));
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && !isLocal(request.getUrl())) {
                    if (request.hasGesture() && ("https".equals(request.getUrl().getScheme()) || "http".equals(request.getUrl().getScheme()))) {
                        try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (ActivityNotFoundException ignored) {}
                    }
                    return true;
                }
                return false;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showFailure(error.getDescription().toString());
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Activity recreation reconnects the existing runtime; persisted files stay intact.
                view.destroy(); web = null; showFailure("页面进程已退出，请重新打开应用。"); return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!isLocal(Uri.parse(url))) return;
                if (!getPreferences(MODE_PRIVATE).getBoolean("storageExplained", false)) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("storageExplained", true).apply();
                    new AlertDialog.Builder(MainActivity.this).setTitle("本地笔记库")
                        .setMessage("默认笔记库保存在应用内，可离线编辑。卸载应用会删除应用内文件。\n\n若要打开 Documents 等位置的现有文件夹，可授权文件访问后，在侧栏底部设置中选择笔记库。之后也可从安卓应用信息的权限设置授权。")
                        .setPositiveButton("使用应用内笔记库", (dialog, which) -> {})
                        .setNeutralButton("访问现有文件夹", (dialog, which) -> requestStorage()).show();
                }
            }
        });
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(parameters.createIntent(), 20); return true; }
                catch (ActivityNotFoundException error) { fileCallback = null; callback.onReceiveValue(null); return true; }
            }
        });
        setContentView(web);
        web.loadUrl(origin);
    }

    private boolean isLocal(Uri uri) {
        return localOrigin != null && "http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()) && Uri.parse(localOrigin).getPort() == uri.getPort();
    }

    private void requestStorage() {
        storagePending = true;
        try { startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))); }
        catch (ActivityNotFoundException error) { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); }
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (storagePending) {
            storagePending = false;
            new AlertDialog.Builder(this).setTitle("文件访问设置已更新")
                .setMessage("请关闭并重新打开应用，再从侧栏底部的设置选择文件夹。当前笔记库保持打开。")
                .setPositiveButton("确定", null).show();
        }
    }

    @Override protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('webobsidian-background'))", null);
            web.onPause();
        }
        super.onPause();
    }

    @Override public void onBackPressed() {
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript("(()=>{const drawer=document.querySelector('.drawer-backdrop'); if(drawer){drawer.click();return true;}return false;})()",
            result -> { if (!"true".equals(result)) moveTaskToBack(true); });
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 20 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null;
        }
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
