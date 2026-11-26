import nodemailer from 'nodemailer';

export async function sendReceiptEmail(
  userId: string,
  orderId: string,
  total: number
): Promise<boolean> {
  const transporter = nodemailer.createTransport({ jsonTransport: true });
  const body = `Order ${orderId} confirmed for $${total}`;
  await transporter.sendMail({
    to: `${userId}@example.com`,
    subject: 'Your PulsePay Receipt',
    text: body
  });
  return true;
}
