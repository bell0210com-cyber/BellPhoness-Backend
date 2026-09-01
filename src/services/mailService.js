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

export async function sendAdminOtpEmail(otp, recipientEmail) {
  const email = recipientEmail || process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'bellphonessdubai@gmail.com';
  
  const subject = `🔐 [BELL Admin] Your 6-Digit Security Verification Code: ${otp}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px; overflow: hidden; padding: 32px 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="font-size: 24px; font-weight: 800; letter-spacing: 2px; color: #111111; margin: 0;">BELL<span style="color: #be9a5d;">.</span></h1>
        <p style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #888888; margin-top: 4px;">Security Access Verification</p>
      </div>

      <div style="border-top: 1px solid #f0ede6; padding-top: 20px; text-align: center;">
        <p style="font-size: 15px; color: #333333; line-height: 1.5; margin: 0 0 16px;">
          An administrator login session was requested for the BELL Admin Console. Please use the verification code below to authorize your session:
        </p>

        <div style="background-color: #fdfaf5; border: 1.5px solid #be9a5d; border-radius: 8px; padding: 18px; margin: 20px 0; display: inline-block; min-width: 240px;">
          <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #be9a5d; font-family: monospace;">${otp}</span>
        </div>

        <p style="font-size: 13px; color: #777777; margin: 12px 0 0;">
          This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.
        </p>
      </div>

      <div style="border-top: 1px solid #f0ede6; margin-top: 28px; padding-top: 16px; text-align: center; font-size: 12px; color: #999999;">
        If you did not initiate this request, please change your administrative credentials immediately.
      </div>
    </div>
  `;

  console.log(`\n======================================================`);
  console.log(`🔐 [ADMIN OTP GENERATED]: >>> ${otp} <<<`);
  console.log(`📧 Destination: ${email}`);
  console.log(`⏰ Expiration: 10 minutes`);
  console.log(`======================================================\n`);

  try {
    const t = await getTransporter();
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || '"BELL Security" <security@bellphoness.com>',
      to: email,
      subject,
      text: `Your BELL Admin verification code is: ${otp}. It expires in 10 minutes.`,
      html,
    });

    console.log(`[Admin OTP Email sent]: Message ID ${info.messageId}`);
    if (info.messageId && nodemailer.getTestMessageUrl(info)) {
      console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    }
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to dispatch Admin OTP email:', error);
    // Still resolve so admin is not hard-locked if SMTP is down locally
    return { success: false, error: error.message };
  }
}

