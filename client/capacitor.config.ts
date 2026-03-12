import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.viridian.app',
  appName: 'Viridian',
  webDir: 'dist',
  // Allow the WebView to connect to any local-network server (user-configured IP)
  server: {
    androidScheme: 'http',
    // cleartext traffic is needed for http:// connections to LAN servers
    allowNavigation: ['*'],
  },
};

export default config;
