// middleware/auth.js
const { Pool } = require('pg');
const pool = require('../models/db');
require('dotenv').config();

const authenticateShop = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'API Key required' });
  }

  try {
    const result = await pool.query('SELECT * FROM shops WHERE api_key = $1', [apiKey]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API Key' });
    }

    req.shop = result.rows[0]; // Attach shop info to request
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { authenticateShop };