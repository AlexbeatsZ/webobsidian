package io.github.alexbeatsz.webobsidian;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.provider.DocumentsContract;
import android.view.*;
import android.webkit.*;
import android.widget.*;

/** Native host only: existing packaged application owns all note behavior. */
public final class MainActivity extends Activity {
    private WebView web;
    private FrameLayout content;
    private String localOrigin;
    private ValueCallback<Uri[]> fileCallback;
    private boolean storagePending;
    private boolean opening;
    private NativeBridge bridge;
    private Thread readiness;
    private String pendingVault;
    private boolean runtimeFailureShown;
    private final Runnable checkRuntime = new Runnable() {
        @Override public void run() {
            if (web != null && RuntimeHost.getFailure() != null && !runtimeFailureShown) {
                runtimeFailureShown = true;
                new AlertDialog.Builder(MainActivity.this).setTitle("本地服务已停止")
                    .setMessage("当前页面的编辑仍保留。重新启动会关闭页面，尚未保存的编辑请先复制。")
                    .setNegativeButton("保留页面", null).setPositiveButton("重新启动", (dialog, which) -> restartRuntime(null)).show();
            }
            handler.postDelayed(this, 2000);
        }
    };
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setDecorFitsSystemWindows(false);
        content = new FrameLayout(this);
        content.setBackgroundColor(android.graphics.Color.WHITE);
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
            android.graphics.Insets bars = insets.getInsets(types);
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            // The parent shrinks the actual WebView bounds. Forward zero overlap
            // rather than applying a second inset in Chromium/CSS.
            return new WindowInsets.Builder(insets).setInsets(types, android.graphics.Insets.NONE).build();
        });
        content.addOnLayoutChangeListener((view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            int edge = Math.round(28 * getResources().getDisplayMetrics().density);
            int half = Math.round(100 * getResources().getDisplayMetrics().density);
            int middle = (view.getPaddingTop() + view.getHeight() - view.getPaddingBottom()) / 2;
            // Parent owns exclusion: WebView may replace its own exclusion list.
            view.setSystemGestureExclusionRects(java.util.Arrays.asList(
                new android.graphics.Rect(0, middle - half, view.getPaddingLeft() + edge, middle + half),
                new android.graphics.Rect(view.getWidth() - view.getPaddingRight() - edge, middle - half, view.getWidth(), middle + half)));
        });
        setContentView(content);
        content.requestApplyInsets();
        bridge = new NativeBridge(this);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        java.io.File restart = new java.io.File(getFilesDir(), "restart-vault.json");
        if (restart.isFile()) {
            try {
                String chosen = new org.json.JSONObject(new String(java.nio.file.Files.readAllBytes(restart.toPath()), java.nio.charset.StandardCharsets.UTF_8)).getString("path");
                java.nio.file.Files.delete(restart.toPath());
                startWorkspace(chosen);
                return;
            } catch (Exception error) { showVaultChoice(error.toString()); return; }
        }
        if (RuntimeHost.isStarted() || getPreferences(MODE_PRIVATE).getBoolean("vaultChosen", false)) startWorkspace(null);
        else showVaultChoice(null);
    }

    private void startWorkspace(String initialVault) {
        if (opening) return;
        if (RuntimeHost.needsRestart() || (RuntimeHost.isStarted() && initialVault != null)) { restartRuntime(initialVault); return; }
        pendingVault = initialVault;
        opening = true;
        showLoading("正在打开所选笔记库…");
        RuntimeHost.start(this, initialVault);
        readiness = new Thread(() -> {
            try {
                String origin = RuntimeHost.awaitReady(getApplicationContext());
                handler.post(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    getPreferences(MODE_PRIVATE).edit().putBoolean("vaultChosen", true).apply();
                    opening = false;
                    openWorkspace(origin);
                });
            } catch (Exception error) { handler.post(() -> showFailure(error.toString())); }
        }, "WebObsidian-Ready");
        readiness.start();
    }

    private void showLoading(String text) {
        TextView label = new TextView(this); label.setText(text); label.setGravity(Gravity.CENTER); label.setTextSize(16);
        content.removeAllViews();
        content.addView(label, new FrameLayout.LayoutParams(-1, -1));
    }

    private void showFailure(String message) {
        if (isFinishing() || isDestroyed()) return;
        opening = false;
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER);
        TextView label = new TextView(this); label.setText("本地笔记库无法启动\n\n" + message); panel.addView(label);
        Button retry = new Button(this); retry.setText("重试");
        retry.setOnClickListener(view -> {
            if (RuntimeHost.getFailure() == null && localOrigin != null) openWorkspace(localOrigin);
            else startWorkspace(pendingVault);
        }); panel.addView(retry);
        Button choose = new Button(this); choose.setText("重新选择笔记库"); choose.setOnClickListener(view -> showVaultChoice(null)); panel.addView(choose);
        content.removeAllViews(); content.addView(panel, new FrameLayout.LayoutParams(-1, -1));
    }

    private void restartRuntime(String vault) {
        Intent recovery = new Intent(this, RecoveryActivity.class).putExtra("pid", android.os.Process.myPid());
        if (vault != null) recovery.putExtra("vault", vault);
        startActivity(recovery);
    }

    private void showVaultChoice(String error) {
        opening = false;
        LinearLayout choices = new LinearLayout(this); choices.setOrientation(LinearLayout.VERTICAL);
        choices.setGravity(Gravity.CENTER); int gap = Math.round(20 * getResources().getDisplayMetrics().density);
        choices.setPadding(gap, gap, gap, gap);
        TextView title = new TextView(this); title.setText("选择本地笔记库"); title.setTextSize(22); choices.addView(title);
        TextView description = new TextView(this);
        description.setText(error == null ? "选择已有文件夹，或主动新建。选择前不会创建笔记库。" : error);
        choices.addView(description);
        Button existing = new Button(this); existing.setText("打开已有笔记库");
        existing.setOnClickListener(view -> {
            if (!Environment.isExternalStorageManager()) requestStorage(); else pickExistingVault();
        }); choices.addView(existing);
        Button create = new Button(this); create.setText("新建应用内笔记库");
        create.setOnClickListener(view -> {
            EditText name = new EditText(this); name.setSingleLine(true); name.setHint("笔记库名称");
            AlertDialog dialog = new AlertDialog.Builder(this).setTitle("新建应用内笔记库")
                .setMessage("保存在应用内，可离线使用。卸载应用会删除这里的文件，请及时备份。")
                .setView(name).setNegativeButton("取消", null).setPositiveButton("新建并打开", null).create();
            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button -> {
                String value = name.getText().toString().trim();
                if (value.isEmpty() || value.equals(".") || value.equals("..") || value.indexOf('/') >= 0 || value.indexOf('\\') >= 0 || value.indexOf(0) >= 0) { name.setError("请输入有效的文件夹名称"); return; }
                java.io.File vault = new java.io.File(getFilesDir(), "vaults/" + value);
                if (vault.exists() || !vault.mkdirs()) { name.setError("目录已存在或无法创建，请使用其他名称"); return; }
                dialog.dismiss(); startWorkspace(vault.getAbsolutePath());
            })); dialog.show();
        }); choices.addView(create);
        java.io.File legacy = new java.io.File(getFilesDir(), "Vault");
        if (legacy.isDirectory()) {
            Button old = new Button(this); old.setText("选择旧版应用内笔记库（保留的 Vault）");
            old.setOnClickListener(view -> confirmVault(legacy)); choices.addView(old);
        }
        Button cancel = new Button(this); cancel.setText("取消"); cancel.setOnClickListener(view -> finish()); choices.addView(cancel);
        content.removeAllViews(); content.addView(choices, new FrameLayout.LayoutParams(-1, -1));
    }

    private void pickExistingVault() {
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { startActivityForResult(picker, 22); }
        catch (ActivityNotFoundException error) { showVaultChoice("系统文件夹选择器不可用，请检查系统文件应用。"); }
    }

    private void confirmVault(java.io.File vault) {
        new AlertDialog.Builder(this).setTitle("打开此笔记库？").setMessage(vault.getAbsolutePath())
            .setNegativeButton("取消", null).setPositiveButton("打开", (dialog, which) -> startWorkspace(vault.getAbsolutePath())).show();
    }

    private void openWorkspace(String origin) {
        localOrigin = origin;
        if (web != null) { bridge.close(); content.removeView(web); web.destroy(); }
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " WebObsidianAndroid/" + BuildConfig.VERSION_NAME);
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
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
                bridge.close(); content.removeView(view); view.destroy(); web = null; showFailure("页面进程已退出，请重新打开应用。"); return true;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view == web && isLocal(Uri.parse(url))) bridge.connect(view, localOrigin);
                content.requestApplyInsets();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(parameters.createIntent(), 20); return true; }
                catch (ActivityNotFoundException error) { fileCallback = null; callback.onReceiveValue(null); return true; }
            }
        });
        content.removeAllViews(); content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        content.requestApplyInsets();
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
        handler.removeCallbacks(checkRuntime); handler.post(checkRuntime);
        if (storagePending) {
            storagePending = false;
            if (Environment.isExternalStorageManager()) pickExistingVault();
            else showVaultChoice("未授予文件访问权限。可再次授权、主动新建应用内笔记库，或取消。");
        }
    }

    @Override protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("window.dispatchEvent(new Event('webobsidian-background'))", null);
            web.onPause();
        }
        handler.removeCallbacks(checkRuntime);
        super.onPause();
    }

    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (web == null) { moveTaskToBack(true); return; }
        web.evaluateJavascript("!window.dispatchEvent(new Event('webobsidian-back',{cancelable:true}))",
            result -> { if (!"true".equals(result)) moveTaskToBack(true); });
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 23) bridge.completeExport(result, data);
        if (request == 20 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data)); fileCallback = null;
        }
        if (request == 22 && result == RESULT_OK && data != null && data.getData() != null) {
            try {
                Uri uri = data.getData();
                if (!"com.android.externalstorage.documents".equals(uri.getAuthority())) throw new java.io.IOException("请选择设备存储中的本地文件夹，云端目录不能直接作为离线笔记库。");
                String[] parts = DocumentsContract.getTreeDocumentId(uri).split(":", 2);
                java.io.File root = "primary".equalsIgnoreCase(parts[0]) ? Environment.getExternalStorageDirectory() : new java.io.File("/storage", parts[0]);
                java.io.File vault = new java.io.File(root, parts.length > 1 ? parts[1] : "").getCanonicalFile();
                if (vault.equals(root.getCanonicalFile())) throw new java.io.IOException("请选择存储根目录中的一个笔记库子文件夹。");
                if (!vault.getPath().startsWith(root.getCanonicalPath() + "/") || !vault.isDirectory() || !vault.canRead() || !vault.canWrite()) throw new java.io.IOException("无法读写此本地文件夹，请选择可访问的笔记库目录。");
                confirmVault(vault);
            } catch (Exception error) { showVaultChoice(error.getMessage()); }
        }
    }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (readiness != null) readiness.interrupt();
        if (bridge != null) bridge.close();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) {
            content.removeView(web); web.stopLoading(); web.loadUrl("about:blank"); web.destroy(); web = null;
        }
        super.onDestroy();
    }
}
