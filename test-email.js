import { sendOrderStatusEmail } from './src/services/mailService.js';

const mockOrder = {
  id: 'test-order-123456',
  status: 'Shipped',
};

async function run() {
  console.log('Sending mock order status email...');
  await sendOrderStatusEmail(mockOrder, 'test@example.com');
  console.log('Done.');
}

run();
