import nodemailer from 'nodemailer';

let transporter;

async function getTransporter() {
  if (transporter) return transporter;

  // 1. Gmail Direct Transport with App Password
  const gmailUser = process.env.GMAIL_USER || (process.env.SMTP_USER && process.env.SMTP_USER.includes('@gmail.com') ? process.env.SMTP_USER : null);
  const gmailPass = process.env.GMAIL_APP_PASSWORD || (gmailUser ? process.env.SMTP_PASS : null);

  if (gmailUser && gmailPass) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser.trim(),
        pass: gmailPass.replace(/\s+/g, ''), // remove any spaces from Google 16-char app passwords
      },
    });
    console.log(`[MailService] Using Gmail App Password transport for: ${gmailUser}`);
    return transporter;
  }

  // 2. Custom SMTP Transport
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST.trim(),
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER.trim(),
        pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''),
      },
    });
    console.log(`[MailService] Using SMTP transport (${process.env.SMTP_HOST})`);
    return transporter;
  }

  // 3. Fallback to Ethereal for testing
  try {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[MailService] No Gmail/SMTP configured. Using Ethereal test account.');
  } catch (e) {
    console.warn('[MailService] Fallback ethereal init error:', e.message);
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


