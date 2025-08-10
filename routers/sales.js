// routes/sales.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticateShop } = require('../middleware/auth');

// 🔐 All routes require authentication

// POST: Upload batch of sales
router.post('/upload', authenticateShop, async (req, res) => {
  const client = await pool.connect();
  const { sales } = req.body;
  const shopId = req.shop.shop_id;

  // Validate input
  if (!Array.isArray(sales)) {
    return res.status(400).json({ error: 'Sales must be an array' });
  }

  if (sales.length === 0) {
    return res.status(400).json({ error: 'No sales to upload' });
  }

  try {
    await client.query('BEGIN');

    const uploaded = [];

    for (const sale of sales) {
      const { variant_id, quantity, unit_price, total_price, sale_date } = sale;

      // Required fields
      if (!variant_id || quantity == null || !unit_price || !sale_date) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Missing required fields: variant_id, quantity, unit_price, sale_date'
        });
      }

      // Auto-calculate total_price if not provided
      const calculatedTotal = total_price ?? (quantity * unit_price);

      // Optional: Prevent duplicates by variant_id + sale_date + quantity?
      // For now, allow same sale multiple times (e.g., two separate transactions)

      await client.query(
        `INSERT INTO sales 
           (shop_id, variant_id, quantity, unit_price, total_price, sale_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [shopId, variant_id, quantity, unit_price, calculatedTotal, sale_date]
      );

      uploaded.push(variant_id);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      received: uploaded.length,
      message: `${uploaded.length} sales uploaded successfully`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sales upload failed:', err);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: err.message 
    });
  } finally {
    client.release();
  }
});

// GET: Get sales by date range
router.get('/', authenticateShop, async (req, res) => {
  const shopId = req.shop.shop_id;
  const { start, end } = req.query;

  let query = 'SELECT * FROM sales WHERE shop_id = $1';
  const values = [shopId];
  let paramCount = 1;

  // Optional: Filter by date range
  if (start) {
    paramCount++;
    query += ` AND sale_date >= $${paramCount}`;
    values.push(start);
  }
  if (end) {
    paramCount++;
    query += ` AND sale_date <= $${paramCount}`;
    values.push(end);
  }

  query += ' ORDER BY sale_date DESC';

  try {
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch sales' });
  }
});

// GET: Get sales by variant
router.get('/variant/:variant_id', authenticateShop, async (req, res) => {
  const { variant_id } = req.params;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `SELECT * FROM sales 
       WHERE variant_id = $1 AND shop_id = $2 
       ORDER BY sale_date DESC`,
      [variant_id, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No sales found for this variant' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch sales' });
  }
});

// GET: Sales summary (daily totals)
router.get('/summary/daily', authenticateShop, async (req, res) => {
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(`
      SELECT 
        DATE(sale_date AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Nairobi') AS sale_day,
        COUNT(*) AS transaction_count,
        SUM(total_price) AS revenue
      FROM sales
      WHERE shop_id = $1
      GROUP BY sale_day
      ORDER BY sale_day DESC
    `, [shopId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate summary' });
  }
});

module.exports = router; 