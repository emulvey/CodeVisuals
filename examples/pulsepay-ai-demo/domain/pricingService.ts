import { fetchTaxRate } from '../data/taxConfig.ts';
import { formatAuditNote } from './paymentService.ts';

export function validateCartItems(items: any[]): any[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Cart cannot be empty');
  }
  const clean = items.filter((item) => item.qty > 0 && item.unitPrice >= 0);
  return clean;
}

export function calculateTotals(items: any[], couponCode?: string) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.unitPrice * item.qty;
  }
  const discount = computeTierDiscount(subtotal, couponCode);
  const taxRate = fetchTaxRate('US');
  const tax = (subtotal - discount) * taxRate;
  const grandTotal = Math.round((subtotal - discount + tax) * 100) / 100;
  const auditNote = formatAuditNote(grandTotal);
  return { subtotal, discount, tax, grandTotal, auditNote };
}

export function computeTierDiscount(amount: number, couponCode?: string): number {
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

// Orphan helper left behind by an earlier AI generation pass
function legacyV1PromoConverter(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (trimmed.startsWith('OLD_')) {
    return trimmed.replace('OLD_', 'LEGACY_');
  }
  return trimmed;
}
