import express from 'express';
import { runCheckoutPipeline } from '../orchestration/checkoutPipeline.ts';
import { getOrderHistory, lookupReceipt } from '../data/orderRepository.ts';

const router = express.Router();

router.post('/api/v1/checkout', async (req, res) => {
  const { userId, cartItems, couponCode, paymentToken } = req.body;
  if (!userId || !cartItems) {
    return res.status(400).json({ error: 'Missing checkout payload' });
  }
  const receipt = await runCheckoutPipeline(userId, cartItems, couponCode, paymentToken);
  return res.status(200).json(receipt);
});

router.get('/api/v1/orders/:userId', async (req, res) => {
  const userId = req.params.userId;
  const orders = await getOrderHistory(userId);
  return res.status(200).json({ userId, orders });
});

router.get('/api/v1/receipts/:orderId', async (req, res) => {
  const receipt = await lookupReceipt(req.params.orderId);
  return res.status(200).json(receipt);
});

export default router;
