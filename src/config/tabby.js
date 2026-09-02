import 'dotenv/config';

export const tabbyConfig = {
  env: process.env.TABBY_ENV || 'sandbox',
  apiUrl: (process.env.TABBY_API_URL || 'https://api.tabby.ai/api/v2').trim(),
  publicKey: (process.env.TABBY_PUBLIC_KEY || 'pk_test_01a03e76-a3d2-02e4-385f-b38bd6ca4d3a').trim(),
  secretKey: (process.env.TABBY_SECRET_KEY || 'sk_test_01a03e76-a3d2-02e4-385f-b38c55a856e3').trim(),
  merchantCode: (process.env.TABBY_MERCHANT_CODE || 'ALJA').trim(),
  webhookSecret: (process.env.TABBY_WEBHOOK_SECRET || '').trim(),
};

export function isTabbyConfigured() {
  return Boolean(
    (tabbyConfig.secretKey && tabbyConfig.secretKey !== 'placeholder_secret_key') ||
    (tabbyConfig.publicKey && tabbyConfig.publicKey !== 'placeholder_public_key')
  );
}
