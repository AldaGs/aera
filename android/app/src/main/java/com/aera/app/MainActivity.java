package com.aera.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register our app-local Samsung Health plugin before the bridge starts.
        registerPlugin(SamsungHealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
