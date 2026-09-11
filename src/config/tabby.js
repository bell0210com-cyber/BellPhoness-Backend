import 'dotenv/config';

const rawPublicKey = (process.env.TABBY_PUBLIC_KEY || '').trim();
const validPublicKey = (rawPublicKey && rawPublicKey !== 'pk_test_01a03e76-a3d2-02e4-385f-b38bd6ca4d3a')
  ? rawPublicKey
  : 'pk_test_b8e21976-59a6-4b82-9ae4-0b7305988e0b';

export const tabbyConfig = {
  env: process.env.TABBY_ENV || 'sandbox',
  apiUrl: (process.env.TABBY_API_URL || 'https://api.tabby.ai/api/v2').trim(),
  publicKey: validPublicKey,
  secretKey: (process.env.TABBY_SECRET_KEY || '').trim(),
  merchantCode: (process.env.TABBY_MERCHANT_CODE || 'ALJA').trim(),
  webhookSecret: (process.env.TABBY_WEBHOOK_SECRET || '').trim(),
};

/**
 * Validates that the Tabby Secret Key (sk_...) is configured for backend calls
 */
export function isTabbyConfigured() {
  return Boolean(
    tabbyConfig.secretKey &&
    tabbyConfig.secretKey !== 'placeholder_secret_key' &&
    tabbyConfig.secretKey.startsWith('sk_')
  );
}

// ─── Startup Configuration Audit ────────────────────────────────────────────
// Console log both tabbyConfig.publicKey and tabbyConfig.secretKey on server startup
console.info(`[Tabby Config] TABBY_PUBLIC_KEY: ${tabbyConfig.publicKey}`);
console.info(`[Tabby Config] TABBY_SECRET_KEY: ${tabbyConfig.secretKey}`);

if (isTabbyConfigured()) {
  console.info(
    `[Tabby] ✅ Configured — env: ${tabbyConfig.env}, ` +
    `merchant: ${tabbyConfig.merchantCode}, ` +
    `public_key: ${tabbyConfig.publicKey}, ` +
    `secret_key: ${tabbyConfig.secretKey.slice(0, 12)}...`
  );
} else {
  console.error(
    '[Tabby] ❌ FATAL: TABBY_SECRET_KEY is missing or does not start with "sk_". ' +
    'Tabby checkout is DISABLED. Set the correct secret key in your server environment variables.'
  );
}

