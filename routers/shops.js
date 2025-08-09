// routes/shops.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticateShop } = require('../middleware/auth'); // Use only after login

// POST: Create shop (after signup + verify)
router.post('/', async (req, res) => {
  const { name, phone, email, address } = req.body;
  const keeperId = req.shop?.keeper_id; // from auth (but shop_id may be null)

  if (!name) {
    return res.status(400).json({ error: 'Shop name is required' });
  }

  try {
    await pool.query('BEGIN');

    // Create shop
    const shopResult = await pool.query(
      `INSERT INTO shops (name, phone, email, address)
       VALUES ($1, $2, $3, $4)
       RETURNING shop_id`,
      [name, phone, email, address]
    );

    const shopId = shopResult.rows[0].shop_id;

    // Link shopkeeper to shop
    await pool.query(
      `UPDATE shopkeepers
       SET shop_id = $1
       WHERE keeper_id = $2`,
      [shopId, keeperId]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Shop created successfully',
      shop_id: shopId
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not create shop' });
  }
});

// GET: Get shop info (after login)
router.get('/', authenticateShop, async (req, res) => {
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      'SELECT * FROM shops WHERE shop_id = $1',
      [shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch shop' });
  }
});

module.exports = router;