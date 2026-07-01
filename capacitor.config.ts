import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aera.app',
  appName: 'aera',
  webDir: 'dist',
  android: {
    // Health Connect data only flows through a real native build.
    allowMixedContent: false,
  },
};

export default config;
