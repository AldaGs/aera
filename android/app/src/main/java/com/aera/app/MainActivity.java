package com.aera.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register our app-local Samsung Health plugin before the bridge starts.
        registerPlugin(SamsungHealthPlugin.class);
        super.onCreate(savedInstanceState);

        // targetSdk 35+ forces edge-to-edge on Android 15, so the content draws
        // under the status/navigation bars. Android doesn't expose the regular
        // status bar via CSS env(safe-area-inset-*), so pad the root content view
        // by the system-bar insets here. Consuming the insets stops children from
        // re-applying them, and requestApplyInsets forces an immediate dispatch.
        final View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
    }
}
