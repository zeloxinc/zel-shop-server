// middleware/auth.js
const pool = require('../models/db');

const authenticateShop = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API Key required' });
  }

  try {
    const result = await pool.query(
      `SELECT 
         s.*,
         k.keeper_code
       FROM shops s
       JOIN shopkeepers k ON s.shop_id = k.shop_id
       WHERE s.api_key = $1`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    req.shop = result.rows[0]; // now includes shop + keeper_code
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// routers/payment.js

const axios = require('axios');
const btoa = require('btoa');

// Function to get M-Pesa access token
const getAccessToken = async () => {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const response = await axios.get(
    'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token; // ← This is the generated token
};

module.exports = { authenticateShop, getAccessToken };