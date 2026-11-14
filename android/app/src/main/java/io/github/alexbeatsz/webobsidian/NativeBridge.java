package io.github.alexbeatsz.webobsidian;

import android.app.Activity;
import android.content.ClipboardManager;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebView;
import java.io.OutputStream;
import org.json.JSONObject;

/** A MessagePort is transferred only to the top-level local application origin. */
final class NativeBridge {
    private final Activity activity;
    private WebMessagePort port;
    private byte[] exportBytes;
    private int exportId;
    NativeBridge(Activity activity) { this.activity = activity; }

    void connect(WebView view, String origin) {
        close();
        WebMessagePort[] ports = view.createWebMessageChannel();
        port = ports[0];
        port.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override public void onMessage(WebMessagePort source, WebMessage message) {
                int id = 0;
                try {
                    JSONObject request = new JSONObject(message.getData());
                    id = request.getInt("id");
                    String action = request.getString("action");
                    if (action.equals("clipboard-read")) {
                        if (!activity.hasWindowFocus()) throw new Exception("请在应用前台执行粘贴");
                        ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                        ClipData clip = clipboard.getPrimaryClip();
                        reply(source, id, clip == null || clip.getItemCount() == 0 ? "" : clip.getItemAt(0).coerceToText(activity).toString(), null);
                    } else if (action.equals("export")) {
                        if (exportBytes != null) throw new Exception("请先完成当前导出");
                        JSONObject input = request.getJSONObject("input");
                        String encoded = input.getString("base64");
                        if (encoded.length() > 32 * 1024 * 1024) throw new Exception("导出文件超过 24 MiB");
                        exportBytes = Base64.decode(encoded, Base64.DEFAULT);
                        exportId = id;
                        Intent picker = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                        String mime = input.optString("mime", "application/octet-stream");
                        picker.setType(mime.isEmpty() ? "application/octet-stream" : mime);
                        picker.putExtra(Intent.EXTRA_TITLE, input.getString("filename").replaceAll("[/\\\\]", "_"));
                        activity.startActivityForResult(picker, 23);
                    } else throw new Exception("不支持的宿主操作");
                } catch (Exception error) {
                    if (id == exportId) exportBytes = null;
                    reply(source, id, null, error.getMessage());
                }
            }
        });
        view.postWebMessage(new WebMessage("webobsidian-host", new WebMessagePort[] { ports[1] }), Uri.parse(origin));
    }

    void completeExport(int result, Intent data) {
        final byte[] bytes = exportBytes;
        final int id = exportId;
        final WebMessagePort source = port;
        if (bytes == null) return;
        if (result != Activity.RESULT_OK || data == null || data.getData() == null) { exportBytes = null; reply(source, id, false, null); return; }
        final Uri uri = data.getData();
        new Thread(() -> {
            try (OutputStream output = activity.getContentResolver().openOutputStream(uri, "w")) {
                if (output == null) throw new Exception("无法写入所选文件");
                output.write(bytes);
                output.flush();
                activity.runOnUiThread(() -> { exportBytes = null; reply(source, id, true, null); });
            } catch (Exception error) { activity.runOnUiThread(() -> { exportBytes = null; reply(source, id, null, error.getMessage()); }); }
        }, "WebObsidian-Export").start();
    }

    private void reply(WebMessagePort source, int id, Object value, String error) {
        if (source == null || source != port) return;
        try { source.postMessage(new WebMessage(new JSONObject().put("id", id).put("value", value).put("error", error).toString())); }
        catch (Exception ignored) { /* The page may have been destroyed during the picker. */ }
    }

    void close() {
        if (port != null) port.close();
        port = null;
        exportBytes = null;
    }
}
