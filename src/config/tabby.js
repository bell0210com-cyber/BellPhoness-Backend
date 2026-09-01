import 'dotenv/config';

export const tabbyConfig = {
  env: process.env.TABBY_ENV || 'sandbox',
  apiUrl: (process.env.TABBY_API_URL || 'https://api.tabby.ai/api/v2').trim(),
  publicKey: (process.env.TABBY_PUBLIC_KEY || '').trim(),
  secretKey: (process.env.TABBY_SECRET_KEY || '').trim(),
  merchantCode: (process.env.TABBY_MERCHANT_CODE || 'ALJA').trim(),
  webhookSecret: (process.env.TABBY_WEBHOOK_SECRET || '').trim(),
};

export function isTabbyConfigured() {
  return Boolean(
    (tabbyConfig.publicKey && tabbyConfig.publicKey !== 'placeholder_public_key') ||
    (tabbyConfig.secretKey && tabbyConfig.secretKey !== 'placeholder_secret_key')
  );
}
