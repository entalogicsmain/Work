package com.entalogics.comeback;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.entalogics.comeback.steps.StepsPlugin;

public class MainActivity extends BridgeActivity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable pauseWebView = () -> {
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) { wv.onPause(); wv.pauseTimers(); }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StepsPlugin.class); // local step-counting plugin (Kotlin)
        super.onCreate(savedInstanceState);
    }

    /* Step counting runs in the foreground service, not in the page. While the app is not on screen the WebView is paused
       (no JS timers, no layout, no painting) so it costs no battery, and it resumes the moment the app comes back.
       The short delay lets the page finish saving what it was doing when the app went to the background. */
    @Override
    public void onStop() {
        super.onStop();
        handler.removeCallbacks(pauseWebView);
        handler.postDelayed(pauseWebView, 2000);
    }

    @Override
    public void onStart() {
        super.onStart();
        handler.removeCallbacks(pauseWebView);
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) { wv.resumeTimers(); wv.onResume(); }
    }
}
