package io.github.alexbeatsz.webobsidian;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Environment;
import java.io.*;
import java.net.*;
import java.nio.file.*;

/** Exactly one embedded runtime per app process; Activity recreation only reattaches. */
final class RuntimeHost {
    static { System.loadLibrary("node"); System.loadLibrary("webobsidian"); }
    private static volatile String origin;
    private static volatile String failure;
    private static boolean started;
    private static native int startNode(String[] args, String[] env, String directory, String log);

    static synchronized boolean isStarted() { return started; }

    static synchronized void start(Context context, String initialVault) {
        if (started) return;
        started = true;
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                File files = app.getFilesDir();
                File code = new File(files, "runtime-" + BuildConfig.VERSION_CODE);
                File ready = new File(code, ".complete");
                if (!ready.isFile()) {
                    code.mkdirs();
                    copyAssets(app.getAssets(), "server", new File(code, "server"));
                    Files.write(ready.toPath(), new byte[0]);
                }
                File data = new File(files, "server-data"); data.mkdirs();
                String configured = initialVault;
                if (configured == null) {
                    String json = new String(Files.readAllBytes(new File(data, "settings.json").toPath()), java.nio.charset.StandardCharsets.UTF_8);
                    configured = new org.json.JSONObject(json).getJSONObject("vault").getString("path");
                }
                File vault = new File(configured);
                if (!vault.isDirectory() || !vault.canRead() || !vault.canWrite()) throw new IOException("无法访问所选笔记库：" + vault);
                File logs = new File(files, "logs"); logs.mkdirs();
                int port;
                try (ServerSocket socket = new ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"))) { port = socket.getLocalPort(); }
                origin = "http://127.0.0.1:" + port;
                String roots = files.getAbsolutePath();
                // Permission is requested only by an explicit storage action in the UI.
                if (Environment.isExternalStorageManager())
                    roots += "," + Environment.getExternalStorageDirectory().getAbsolutePath() + "," + vault.getCanonicalPath();
                String[] env = {
                    "NODE_ENV=production", "HOST=127.0.0.1", "PORT=" + port,
                    "DATA_DIR=" + data, "VAULT_PATH=" + vault, "ALLOWED_ROOTS=" + roots,
                    "WEBOBSIDIAN_INITIAL_VAULT=" + (initialVault == null ? "" : initialVault),
                    "HOME=" + files, "TMPDIR=" + app.getCacheDir(),
                    "NODE_OPTIONS=--max-old-space-size=384", "WEBOBSIDIAN_PLATFORM=android"
                };
                int codeResult = startNode(new String[] { "node", new File(code, "server/dist/index.mjs").getAbsolutePath() },
                    env, files.getAbsolutePath(), new File(logs, "server.log").getAbsolutePath());
                failure = "本地运行时已退出（" + codeResult + "）。请关闭并重新打开应用。";
            } catch (Throwable error) { failure = error.toString(); }
        }, "WebObsidian-Node").start();
    }

    static String awaitReady() throws Exception {
        long deadline = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < deadline) {
            if (failure != null) throw new IOException(failure);
            String url = origin;
            if (url != null) {
                HttpURLConnection connection = (HttpURLConnection) new URL(url + "/healthz").openConnection();
                connection.setConnectTimeout(1000); connection.setReadTimeout(1000);
                try { if (connection.getResponseCode() == 200) return url; }
                catch (IOException ignored) {} finally { connection.disconnect(); }
            }
            Thread.sleep(250);
        }
        throw new IOException("本地笔记库启动超时。日志位于应用 files/logs/server.log。");
    }

    private static void copyAssets(AssetManager assets, String source, File target) throws IOException {
        String[] children = assets.list(source);
        if (children != null && children.length > 0) {
            if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create " + target);
            for (String child : children) copyAssets(assets, source + "/" + child, new File(target, child));
        } else {
            try (InputStream input = assets.open(source); OutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[65536]; int length;
                while ((length = input.read(buffer)) >= 0) output.write(buffer, 0, length);
            }
        }
    }
}
