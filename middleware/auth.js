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

module.exports = { authenticateShop };