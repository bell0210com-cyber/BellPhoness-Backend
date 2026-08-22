import nodemailer from 'nodemailer';

let transporter;

async function getTransporter() {
  if (transporter) return transporter;

  // Use real SMTP if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    // Fallback to ethereal email for testing
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log('No SMTP configuration found. Using Ethereal test account.');
  }

  return transporter;
}

export async function sendOrderStatusEmail(order, customerEmail) {
  if (!customerEmail) {
    console.warn(`No email found for order ${order.id}. Skipping notification.`);
    return;
  }

  let subject = `Order ${order.status}`;
  let text = '';

  switch (order.status) {
    case 'Confirmed':
      subject = `Your order #${order.id.slice(0, 8)} has been confirmed!`;
      text = 'Your order has been confirmed and is being prepared.';
      break;
    case 'Packed':
      subject = `Your order #${order.id.slice(0, 8)} is packed`;
      text = 'Your order has been packed and will be shipped soon.';
      break;
    case 'Shipped':
      subject = `Your order #${order.id.slice(0, 8)} has shipped!`;
      text = 'Your order is on its way!';
      break;
    case 'Delivered':
      subject = `Your order #${order.id.slice(0, 8)} has been delivered`;
      text = 'Your order has been delivered. Thank you for shopping with BELL!';
      break;
    case 'Cancelled':
      subject = `Update on your order #${order.id.slice(0, 8)}`;
      text = 'Your order has been cancelled. Contact support if you have questions.';
      break;
    default:
      // Don't send emails for 'Pending' or unknown statuses
      return;
  }

  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || '"BELL" <noreply@bellphoness.com>',
      to: customerEmail,
      subject,
      text: `${text}\n\nYou can view your order details here: https://bellphoness.com/orders/${order.id}`,
      html: `<p>${text}</p><p><a href="https://bellphoness.com/orders/${order.id}">View your order</a></p>`
    });

    console.log(`Order status email sent to ${customerEmail}: ${info.messageId}`);
    
    // Log ethereal preview URL if using test account
    if (info.messageId && nodemailer.getTestMessageUrl(info)) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error(`Failed to send order status email for order ${order.id}:`, error);
  }
}
