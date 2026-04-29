import { config } from 'dotenv';
import { loginInteractive } from './auth.js';

config();

(async () => {
  try {
    await loginInteractive();
    console.log('[GA4 OAuth] 認証完了。トークンを .cache/ga4-token.json に保存しました。');
  } catch (e) {
    console.error('[GA4 OAuth] エラー:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
