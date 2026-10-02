package com.entalogics.comeback;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.entalogics.comeback.steps.StepsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepsPlugin.class); // local step-counting plugin (Kotlin)
        super.onCreate(savedInstanceState);
    }
}
