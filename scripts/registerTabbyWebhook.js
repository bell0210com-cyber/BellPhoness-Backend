import 'dotenv/config';

const TABBY_SECRET_KEY = process.env.TABBY_SECRET_KEY || 'sk_test_01a03e76-a3d2-02e4-385f-b38c55a856e3';
const WEBHOOK_URL = 'https://bellphoness.com/api/tabby/webhook';

async function registerWebhook() {
  console.log('--- Registering Tabby Webhook ---');
  console.log('Target Webhook URL:', WEBHOOK_URL);
  console.log('Using Secret Key:', TABBY_SECRET_KEY.slice(0, 16) + '...');

  const endpoints = [
    'https://api.tabby.ai/api/v2/webhooks',
    'https://api.tabby.ai/api/v1/webhooks',
  ];

  for (const endpoint of endpoints) {
    try {
      console.log(`\nSending POST request to ${endpoint}...`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TABBY_SECRET_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          events: ['payment.authorized'],
        }),
      });

      const data = await response.json().catch(() => ({}));
      console.log(`Status: ${response.status} ${response.statusText}`);
      console.log('Response Payload:', JSON.stringify(data, null, 2));

      if (response.ok) {
        console.log('✅ Tabby Webhook registered successfully!');
        return;
      }
    } catch (error) {
      console.error(`❌ Request error on ${endpoint}:`, error.message);
    }
  }
}

registerWebhook();
