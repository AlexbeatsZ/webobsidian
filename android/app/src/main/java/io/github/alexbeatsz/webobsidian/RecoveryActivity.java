package io.github.alexbeatsz.webobsidian;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/** Explicit recovery runs briefly outside the process that embedded Node owns. */
public final class RecoveryActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            String vault = getIntent().getStringExtra("vault");
            File choice = new File(getFilesDir(), "restart-vault.json");
            if (vault != null) Files.write(choice.toPath(), new org.json.JSONObject().put("path", vault).toString().getBytes(StandardCharsets.UTF_8));
            else Files.deleteIfExists(choice.toPath());
            int previous = getIntent().getIntExtra("pid", -1);
            if (previous > 0 && previous != android.os.Process.myPid()) android.os.Process.killProcess(previous);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                finish();
            }, 400);
        } catch (Exception error) {
            android.widget.TextView text = new android.widget.TextView(this);
            text.setText("无法重新启动应用\n" + error);
            setContentView(text);
        }
    }
}
