import axios from 'axios';

export async function getCmcFearGreed(apiKey) {
  if (!apiKey) return null;
  const { data } = await axios.get('https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest', {
    headers: { 'X-CMC_PRO_API_KEY': apiKey }
  });
  return data;
}
