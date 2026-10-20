import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();
if (serverUrl && !serverUrl.startsWith('https://')) {
  throw new Error('CAPACITOR_SERVER_URL must use HTTPS');
}

const config: CapacitorConfig = {
  appId: 'com.chuji.personal',
  appName: '初记',
  webDir: 'dist',
  ...(serverUrl ? { server: { url: serverUrl } } : {}),
};

export default config;
