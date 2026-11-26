import axios from 'axios';

export async function scoreRiskProfile(
  userId: string,
  amount: number,
  itemCount: number
): Promise<{ score: number; blocked: boolean }> {
  const payload = { userId, amount, itemCount };
  const response = await axios.post('http://fraud-py:8001/score', payload);
  const score = response.data.score;
  const blocked = score >= 0.85;
  return { score, blocked };
}
