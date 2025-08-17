// routes/shops.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticateShop } = require('../middleware/auth');

// POST: Create shop
router.post('/', authenticateShop, async (req, res) => {
  const { name, phone, email, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Shop name is required' });
  }

  try {
    await pool.query('BEGIN');

    // 🔍 Step 1: Get the shopkeeper who owns this api_key
    const keeperResult = await pool.query(
      `SELECT k.keeper_code, k.first_name
       FROM shopkeepers k
       JOIN shops s ON k.shop_id = s.shop_id
       WHERE s.api_key = $1`,
      [req.headers['x-api-key']]
    );

    if (keeperResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(403).json({ error: 'Invalid API key or no shop assigned' });
    }

    const keeperCode = keeperResult.rows[0].keeper_code;

    // Step 2: Create the shop
    const shopResult = await pool.query(
      `INSERT INTO shops (name, phone, email, address)
       VALUES ($1, $2, $3, $4)
       RETURNING shop_id`,
      [name, phone, email, address]
    );

    const shopId = shopResult.rows[0].shop_id;

    // Step 3: Link shopkeeper to this new shop
    await pool.query(
      `UPDATE shopkeepers 
       SET shop_id = $1
       WHERE keeper_code = $2`,
      [shopId, keeperCode]
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

// GET: Get current user's shop
router.get('/', authenticateShop, async (req, res) => {
  const shopId = req.shop.shop_id;

  if (!shopId) {
    return res.status(404).json({ error: 'No shop assigned to this account' });
  }

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

// GET: Get a specific shop by ID (admin or shared use)
router.get('/:shop_id', authenticateShop, async (req, res) => {
  const { shop_id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM shops WHERE shop_id = $1',
      [shop_id]
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

// PUT: Update current user's shop
router.put('/', authenticateShop, async (req, res) => {
  const { name, phone, email, address } = req.body;
  const shopId = req.shop.shop_id;

  if (!shopId) {
    return res.status(400).json({ error: 'No shop assigned to your account' });
  }

  try {
    const result = await pool.query(
      `UPDATE shops
       SET name = $1, phone = $2, email = $3, address = $4, updated_at = NOW()
       WHERE shop_id = $5
       RETURNING *`,
      [name, phone, email, address, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    res.json({
      message: 'Shop updated successfully',
      shop: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update shop' });
  }
});

// DELETE: Delete current user's shop (⚠️ Use with caution)
router.delete('/', authenticateShop, async (req, res) => {
  const shopId = req.shop.shop_id;

  if (!shopId) {
    return res.status(400).json({ error: 'No shop to delete' });
  }

  try {
    await pool.query('BEGIN');

    // Remove link from shopkeepers
    await pool.query('UPDATE shopkeepers SET shop_id = NULL WHERE shop_id = $1', [shopId]);

    // Delete shop
    await pool.query('DELETE FROM shops WHERE shop_id = $1', [shopId]);

    await pool.query('COMMIT');

    res.json({ message: 'Shop deleted successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not delete shop' });
  }
});

module.exports = router;