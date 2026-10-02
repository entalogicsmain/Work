package com.umar.resetlog;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.umar.resetlog.steps.StepsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepsPlugin.class); // local step-counting plugin (Kotlin)
        super.onCreate(savedInstanceState);
    }
}
