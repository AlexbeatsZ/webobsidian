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
    private static volatile boolean nodeEntered;
    private static native int startNode(String[] args, String[] env, String directory, String log);

    static synchronized boolean isStarted() { return started; }

    static boolean needsRestart() { return nodeEntered && failure != null; }
    static String getFailure() { return failure; }

    static synchronized void start(Context context, String initialVault) {
        if (started) return;
        started = true;
        failure = null;
        Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                File files = app.getFilesDir();
                String buildId;
                try (InputStream input = app.getAssets().open("runtime-id.txt")) {
                    buildId = new BufferedReader(new InputStreamReader(input, java.nio.charset.StandardCharsets.UTF_8)).readLine().trim();
                }
                if (!buildId.matches("[a-zA-Z0-9-]+")) throw new IOException("Invalid runtime build ID");
                File code = new File(files, "runtime-" + buildId);
                File ready = new File(code, ".complete");
                if (!ready.isFile()) {
                    removeTree(code);
                    if (!code.mkdirs()) throw new IOException("Cannot create " + code);
                    copyAssets(app.getAssets(), "server", new File(code, "server"));
                    Files.write(ready.toPath(), new byte[0]);
                }
                File[] old = files.listFiles(file -> file.isDirectory() && file.getName().startsWith("runtime-") && !file.equals(code));
                if (old != null) for (File entry : old) removeTree(entry);
                File data = new File(files, "server-data"); data.mkdirs();
                Files.deleteIfExists(new File(data, "operations-endpoint.json").toPath());
                Files.deleteIfExists(new File(data, "operations-endpoint.starting.json").toPath());
                File logs = new File(files, "logs"); logs.mkdirs();
                File log = new File(logs, "server.log");
                if (log.length() >= 4 * 1024 * 1024) {
                    Files.move(log.toPath(), new File(logs, "server.log.1").toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
                org.json.JSONArray roots = new org.json.JSONArray().put(files.getAbsolutePath());
                if (Environment.isExternalStorageManager()) roots.put("/storage");
                String[] env = {
                    "NODE_ENV=production", "PORT=0",
                    "DATA_DIR=" + data, "VAULT_PATH=" + (initialVault == null ? new File(files, "unselected-vault").getAbsolutePath() : initialVault),
                    "ALLOWED_ROOTS_JSON=" + roots, "WEBOBSIDIAN_REQUIRE_VAULT=1", "WEBOBSIDIAN_EMBEDDED=1",
                    "WEBOBSIDIAN_INITIAL_VAULT=" + (initialVault == null ? "" : initialVault),
                    "HOME=" + files, "TMPDIR=" + app.getCacheDir(),
                    "NODE_OPTIONS=--max-old-space-size=1024", "WEBOBSIDIAN_SEARCH_CACHE=0", "WEBOBSIDIAN_INDEX_PROGRESS=1"
                };
                nodeEntered = true;
                int codeResult = startNode(new String[] { "node", new File(code, "server/dist/index.mjs").getAbsolutePath() },
                    env, files.getAbsolutePath(), new File(logs, "server.log").getAbsolutePath());
                failure = "本地运行时已退出（" + codeResult + "）。请关闭并重新打开应用。";
            } catch (Throwable error) { failure = error.toString(); }
            finally { synchronized (RuntimeHost.class) { if (!nodeEntered) started = false; } }
        }, "WebObsidian-Node").start();
    }

    static String awaitReady(Context context) throws Exception {
        long deadline = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < deadline) {
            if (failure != null) throw new IOException(failure);
            if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
            String url = origin;
            {
                try {
                    File endpointFile = new File(context.getFilesDir(), "server-data/operations-endpoint.starting.json");
                    if (!endpointFile.isFile()) endpointFile = new File(context.getFilesDir(), "server-data/operations-endpoint.json");
                    String json = new String(Files.readAllBytes(endpointFile.toPath()), java.nio.charset.StandardCharsets.UTF_8);
                    org.json.JSONObject endpoint = new org.json.JSONObject(json);
                    if (endpoint.getInt("protocol") == 1 && endpoint.getInt("pid") == android.os.Process.myPid()) {
                        if (endpoint.has("failure")) { failure = endpoint.getString("failure"); throw new IOException(failure); }
                        URL candidate = new URL(endpoint.getString("url"));
                        if (candidate.getProtocol().equals("http") && candidate.getHost().equals("127.0.0.1")) origin = url = candidate.toString();
                    }
                } catch (IOException | org.json.JSONException ignored) {}
            }
            if (url != null) {
                HttpURLConnection connection = (HttpURLConnection) new URL(url + "/healthz").openConnection();
                connection.setConnectTimeout(1000); connection.setReadTimeout(1000);
                try {
                    int status = connection.getResponseCode();
                    if (status == 200) return url;
                    if (status == 503) deadline = System.currentTimeMillis() + 120_000;
                }
                catch (IOException ignored) {} finally { connection.disconnect(); }
            }
            Thread.sleep(250);
        }
        throw new IOException("本地笔记库启动超时。日志位于应用 files/logs/server.log。");
    }

    private static void removeTree(File target) throws IOException {
        File[] children = target.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        Files.deleteIfExists(target.toPath());
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
