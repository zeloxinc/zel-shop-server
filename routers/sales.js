// routes/sales.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticateShop } = require('../middleware/auth');

router.use(authenticateShop);

// POST: Upload batch of sales
router.post('/upload', authenticateShop, async (req, res) => {
  const client = await pool.connect();
  const { sales } = req.body;
  const shopId = req.shop.shop_id;

  if (!Array.isArray(sales)) {
    return res.status(400).json({ error: 'Sales must be an array' });
  }

  try {
    await client.query('BEGIN');

    for (const sale of sales) {
      const { variant_id, quantity, unit_price, total_price, sale_date } = sale;

      await client.query(
        `INSERT INTO sales 
           (shop_id, variant_id, quantity, unit_price, total_price, sale_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [shopId, variant_id, quantity, unit_price, total_price, sale_date]
      );
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      received: sales.length,
      message: 'Sales uploaded successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  } finally {
    client.release();
  }
});

module.exports = router;