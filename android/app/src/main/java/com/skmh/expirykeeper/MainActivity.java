package com.skmh.expirykeeper;

import android.os.Bundle;
import android.content.pm.ApplicationInfo;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 自定义插件需要在 super.onCreate 之前注册，热更新路径才能在首屏加载前生效
        registerPlugin(WebBundleUpdaterPlugin.class);
        registerPlugin(NotificationSupportPlugin.class);
        registerPlugin(SecureKeyStorePlugin.class);
        super.onCreate(savedInstanceState);
        // Capacitor 初始化时会按配置关闭调试；这里在它之后按构建类型再定一次：
        // release 永远关闭（Chrome DevTools 看不到页面），debug 保持可调试。
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);
    }
}
