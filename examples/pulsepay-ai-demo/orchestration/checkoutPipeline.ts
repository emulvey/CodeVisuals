import { validateCartItems, calculateTotals } from '../domain/pricingService.ts';
import { scoreRiskProfile } from '../domain/fraudBridge.ts';
import { chargePaymentGateway } from '../domain/paymentService.ts';
import { saveOrderRecord } from '../data/orderRepository.ts';
import { sendReceiptEmail } from '../data/notificationClient.ts';

export async function runCheckoutPipeline(
  userId: string,
  cartItems: any[],
  couponCode: string,
  paymentToken: string
): Promise<object> {
  const verifiedItems = validateCartItems(cartItems);
  const pricing = calculateTotals(verifiedItems, couponCode);
  const risk = await scoreRiskProfile(userId, pricing.grandTotal, verifiedItems.length);

  if (risk.blocked) {
    throw new Error('Transaction rejected by fraud guard');
  }

  // Subtle AI bug: paymentService was refactored to require currency, but caller omitted it!
  const charge = await chargePaymentGateway(paymentToken, pricing.grandTotal);
  const savedOrder = await saveOrderRecord(userId, verifiedItems, pricing, charge.txId);

  // Subtle AI bug: unawaited async notification call
  sendReceiptEmail(userId, savedOrder.orderId, pricing.grandTotal);

  return {
    orderId: savedOrder.orderId,
    txId: charge.txId,
    totalCharged: pricing.grandTotal,
    riskScore: risk.score
  };
}
