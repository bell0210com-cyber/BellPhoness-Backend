import 'dotenv/config';

const isProduction = process.env.TAMARA_ENV === 'production';

export const tamaraConfig = {
  env: process.env.TAMARA_ENV || (isProduction ? 'production' : 'sandbox'),
  apiUrl: (process.env.TAMARA_API_BASE_URL || process.env.TAMARA_API_URL || (isProduction ? 'https://api.tamara.co' : 'https://api-sandbox.tamara.co')).trim(),
  checkoutUrl: (process.env.TAMARA_CHECKOUT_URL || (isProduction ? 'https://checkout.tamara.co' : 'https://checkout-sandbox.tamara.co')).trim(),
  apiToken: (process.env.TAMARA_API_TOKEN || '').trim(),
  notificationToken: (process.env.TAMARA_NOTIFICATION_TOKEN || process.env.TAMARA_NOTIFICATION_KEY || '').trim(),
  publicKey: (process.env.TAMARA_PUBLIC_KEY || '').trim(),
};

export function isTamaraConfigured() {
  return Boolean(
    tamaraConfig.apiToken && 
    tamaraConfig.apiToken !== 'placeholder_api_token'
  );
}
