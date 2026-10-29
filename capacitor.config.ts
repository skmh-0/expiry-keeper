import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.skmh.expirykeeper',
  appName: '效期管家',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // 允许在应用内访问局域网更新源（http://192.168.x.x）
    allowMixedContent: true,
    captureInput: true,
    // release 默认关闭；debug 构建由 MainActivity 按 BuildConfig.DEBUG 打开
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#fbf8f2',
      showSpinner: false,
      launchAutoHide: true,
      launchShowDuration: 400,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_expiry',
      iconColor: '#1f6b4c',
    },
  },
};

export default config;
