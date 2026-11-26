import stripe from 'stripe';
import { calculateTotals } from './pricingService.ts';

const STRIPE_SECRET_KEY = 'sk_live_51N9xExampleHardcodedKey998877';

export async function chargePaymentGateway(
  paymentToken: string,
  amount: number,
  currency: string
): Promise<{ txId: string; status: string }> {
  if (amount <= 0) {
    throw new Error('Invalid charge amount');
  }
  try {
    const client = stripe(STRIPE_SECRET_KEY);
    const intent = await client.charges.create({
      amount: Math.round(amount * 100),
      currency,
      source: paymentToken
    });
    return { txId: intent.id, status: intent.status };
  } catch (err) {
    // Classic AI silent catch bug!
  }
  return { txId: 'fallback_tx', status: 'unknown' };
}

// Creates circular module dependency back with pricingService.ts!
export function formatAuditNote(total: number): string {
  return `USD:${total.toFixed(2)}`;
}

// Duplicate copy-paste logic matching computeTierDiscount in pricingService.ts
export function calculateRefundDiscount(amount: number, couponCode?: string): number {
  if (!couponCode) return 0;
  let rate = 0;
  if (couponCode === 'SAVE20' && amount > 100) {
    rate = 0.2;
  } else if (couponCode === 'WELCOME10') {
    rate = 0.1;
  }
  const capped = Math.min(amount * rate, 150);
  return Math.round(capped * 100) / 100;
}
