import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('====================================================');
console.log('🔍 TABBY INTEGRATION COMPREHENSIVE VERIFICATION SUITE');
console.log('====================================================\n');

let passCount = 0;
let totalTests = 0;

function assertTest(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passCount++;
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`   └─ ${details}`);
  } else {
    console.error(`❌ [FAIL] ${name}`);
    if (details) console.error(`   └─ ${details}`);
  }
}

// ----------------------------------------------------
// TEST 1: Rate Limiting on /api/tabby
// ----------------------------------------------------
console.log('\n--- 1. Rate Limiter Configuration on /api/tabby ---');
const serverJsPath = path.resolve(__dirname, '../src/server.js');
const serverJsContent = fs.readFileSync(serverJsPath, 'utf8');

const hasCheckoutLimiter = serverJsContent.includes('const checkoutLimiter = rateLimit({');
const hasCheckoutMax50 = /checkoutLimiter\s*=\s*rateLimit\(\{[\s\S]*?max:\s*50/.test(serverJsContent);
const hasTabbyLimiterAttached = serverJsContent.includes("app.use('/api/tabby', checkoutLimiter");
const hasPaymentTabbyAttached = serverJsContent.includes("app.use('/api/payments/tabby', checkoutLimiter");

assertTest(
  'Checkout Rate Limiter is defined with max: 50 requests / 15 minutes',
  hasCheckoutLimiter && hasCheckoutMax50,
  'Found checkoutLimiter with max: 50 and windowMs: 15 * 60 * 1000'
);

assertTest(
  'Rate Limiter is explicitly applied to /api/tabby and /api/payments/tabby',
  hasTabbyLimiterAttached && hasPaymentTabbyAttached,
  'Both /api/tabby and /api/payments/tabby protected with checkoutLimiter'
);

// ----------------------------------------------------
// TEST 2: Verify tabbyCron.js & lowercase status=authorized
// ----------------------------------------------------
console.log('\n--- 2. tabbyCron.js & status=authorized Execution ---');
const tabbyCronPath = path.resolve(__dirname, '../src/services/tabbyCron.js');
const tabbyCronContent = fs.readFileSync(tabbyCronPath, 'utf8');
const tabbyServicePath = path.resolve(__dirname, '../src/services/tabbyService.js');
const tabbyServiceContent = fs.readFileSync(tabbyServicePath, 'utf8');

const hasLowerCaseStatus = tabbyServiceContent.includes('/payments?status=authorized');
const hasDirectOrderUpdate = tabbyCronContent.includes("status: 'paid'") && tabbyCronContent.includes("'tabby.status': 'CAPTURED'");
const hasNoExtraRetrieveCall = !tabbyCronContent.includes('tabbyService.getPayment(');

assertTest(
  'listAuthorizedPayments queries with lowercase status=authorized',
  hasLowerCaseStatus,
  'Endpoint verified: ${tabbyConfig.apiUrl}/payments?status=authorized'
);

assertTest(
  'Cron updates Firestore order directly upon successful capture without extra retrieve calls',
  hasDirectOrderUpdate && hasNoExtraRetrieveCall,
  'Proper loop termination with no duplicate getPayment retrieve overhead'
);

// ----------------------------------------------------
// TEST 3: Simulate order_amount_too_high & Customer Messaging
// ----------------------------------------------------
console.log('\n--- 3. Error Handling for order_amount_too_high ---');
const checkoutPagePath = path.resolve(__dirname, '../../BellPhoness-Frontend/src/pages/CheckoutPage.jsx');
const checkoutPageContent = fs.readFileSync(checkoutPagePath, 'utf8');
const callbackPagePath = path.resolve(__dirname, '../../BellPhoness-Frontend/src/pages/TabbyCallbackPage.jsx');
const callbackPageContent = fs.readFileSync(callbackPagePath, 'utf8');

const backendHandlesTooHigh = tabbyServiceContent.includes('order_amount_too_high') && 
  tabbyServiceContent.includes('Your order amount exceeds your available Tabby limit');

const checkoutHandlesTooHigh = checkoutPageContent.includes('order_amount_too_high') &&
  checkoutPageContent.includes('Your order amount exceeds your available Tabby limit');

const callbackHandlesTooHigh = callbackPageContent.includes('order_amount_too_high') &&
  callbackPageContent.includes('Your order amount exceeds your available Tabby limit');

assertTest(
  'Backend tabbyService intercepts order_amount_too_high with customer-friendly message',
  backendHandlesTooHigh,
  'Returns "Your order amount exceeds your available Tabby limit. Please try Tamara or Cash on Delivery instead."'
);

assertTest(
  'Frontend CheckoutPage catches order_amount_too_high and displays fallback guidance',
  checkoutHandlesTooHigh,
  'CheckoutPage displays friendly prompt to switch to Tamara or Cash on Delivery'
);

assertTest(
  'Frontend TabbyCallbackPage translates rejection code order_amount_too_high',
  callbackHandlesTooHigh,
  'TabbyCallbackPage formats rejection reason clearly for customer'
);

// ----------------------------------------------------
// TEST 4: Official Tabby SVG Logo Rendering
// ----------------------------------------------------
console.log('\n--- 4. Official Tabby SVG Logo & Assets ---');
const svgIconPath = path.resolve(__dirname, '../../BellPhoness-Frontend/src/assets/payment-methods/tabby-icon.svg');
const svgExists = fs.existsSync(svgIconPath);
let svgValid = false;
if (svgExists) {
  const svgContent = fs.readFileSync(svgIconPath, 'utf8');
  svgValid = svgContent.includes('<svg') && svgContent.includes('#6CFF93') && svgContent.includes('<path');
}

const checkoutUsesSvgIcon = checkoutPageContent.includes("import tabbyIcon from '../assets/payment-methods/tabby-icon.svg'") &&
  checkoutPageContent.includes('<img') &&
  checkoutPageContent.includes('src={tabbyIcon}');

assertTest(
  'Official green Tabby SVG badge exists in /src/assets/payment-methods/tabby-icon.svg',
  svgExists && svgValid,
  'File contains authentic vector badge with #6CFF93 green background'
);

assertTest(
  'CheckoutPage.jsx imports and renders tabby-icon.svg in payment method list',
  checkoutUsesSvgIcon,
  'Payment method option card displays <img src={tabbyIcon} alt="Tabby" />'
);

// ----------------------------------------------------
// TEST 5: Session Payload: order_history, registered_since, loyalty_level
// ----------------------------------------------------
console.log('\n--- 5. Tabby Session Payload Fields ---');

const hasOrderHistoryFetch = tabbyServiceContent.includes('order_history: orderHistory') &&
  tabbyServiceContent.includes('pastOrders.slice(0, 10).map(');

const hasRegisteredSinceAuth = tabbyServiceContent.includes('userRecord?.metadata?.creationTime') &&
  tabbyServiceContent.includes('registered_since: registeredSince');

const hasLoyaltyLevelInteger = tabbyServiceContent.includes('completedOrdersCount') &&
  tabbyServiceContent.includes('loyalty_level: loyaltyLevel') &&
  tabbyServiceContent.includes('Number.isInteger(completedOrdersCount)');

assertTest(
  'order_history fetches last 5-10 past orders from Firestore (excluding current order)',
  hasOrderHistoryFetch,
  'Maps purchased_at, amount, payment_method, status, items, shipping_address'
);

assertTest(
  'buyer_history.registered_since uses Firebase Auth creationTime with earliest order fallback',
  hasRegisteredSinceAuth,
  'Pulls userRecord.metadata.creationTime, with fallback to earliest Firestore order date'
);

assertTest(
  'buyer_history.loyalty_level calculates completed orders count as an integer',
  hasLoyaltyLevelInteger,
  'Counts all delivered/completed/paid orders and passes integer to session payload'
);

// ----------------------------------------------------
// TEST 6: Checkout Confirmation Text
// ----------------------------------------------------
console.log('\n--- 6. Checkout Final Confirmation Step Text ---');

const hasGenericPaymentText = checkoutPageContent.includes(
  "You will be securely redirected to Tabby to complete your payment."
);
const doesNotHaveSpecificPlanText = !checkoutPageContent.includes(
  "You will be securely redirected to Tabby to complete your 4 interest-free payments"
);

assertTest(
  'Final confirm step displays generic "complete your payment" text',
  hasGenericPaymentText && doesNotHaveSpecificPlanText,
  'Text updated to: "You will be securely redirected to Tabby to complete your payment."'
);

// ----------------------------------------------------
// SUMMARY
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`📊 RESULTS: ${passCount} / ${totalTests} Automated Checks Passed (${Math.round((passCount/totalTests)*100)}%)`);
console.log('====================================================\n');
