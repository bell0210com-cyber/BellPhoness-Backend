import 'dotenv/config';

export const tabbyConfig = {
  env: process.env.TABBY_ENV || 'sandbox',
  apiUrl: (process.env.TABBY_API_URL || 'https://api.tabby.ai/api/v2').trim(),
  publicKey: (process.env.TABBY_PUBLIC_KEY || 'pk_test_b8e21976-59a6-4b82-9ae4-0b7305988e0b').trim(),
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
// Runs once when the module is first imported (i.e. at server startup).
// Prints a clear FATAL warning if the secret key is absent so no checkout
// request can ever silently fall through to a simulated/mock path.
if (isTabbyConfigured()) {
  console.info(
    `[Tabby] ✅ Configured — env: ${tabbyConfig.env}, ` +
    `merchant: ${tabbyConfig.merchantCode}, ` +
    `public_key: ${tabbyConfig.publicKey ? tabbyConfig.publicKey.slice(0, 12) + '...' : 'missing'}, ` +
    `secret_key: ${tabbyConfig.secretKey.slice(0, 12)}...`
  );
} else {
  console.error(
    '[Tabby] ❌ FATAL: TABBY_SECRET_KEY is missing or does not start with "sk_". ' +
    'Tabby checkout is DISABLED. Set the correct secret key in your server environment variables.'
  );
}

