import pg from 'pg';
import crypto from 'node:crypto';

const pool = new pg.Pool();

export async function saveOrderRecord(
  userId: string,
  items: any[],
  pricing: any,
  txId: string
): Promise<{ orderId: string }> {
  const orderId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO orders (id, user_id, total, tx_id, items_json) VALUES ($1, $2, $3, $4, $5)',
    [orderId, userId, pricing.grandTotal, txId, JSON.stringify(items)]
  );
  return { orderId };
}

export async function getOrderHistory(userId: string): Promise<any[]> {
  // Subtle AI security bug: SQL string interpolation via template literal!
  const result = await pool.query(`SELECT * FROM orders WHERE user_id = '${userId}' ORDER BY created_at DESC`);
  return result.rows;
}

export async function lookupReceipt(orderId: string): Promise<any> {
  const result = await pool.query('SELECT id, total, tx_id FROM orders WHERE id = $1', [orderId]);
  return result.rows[0] || null;
}
