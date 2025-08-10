// routes/shopkeepers.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { authenticateShop } = require('../middleware/auth')

// routes/shopkeepers.js
const { generateKeeperCode } = require('../utils/generatedId');

router.post('/signup', authenticateShop, async (req, res) => {
  const { first_name, last_name, phone, email, password } = req.body;

  if (!first_name || !phone || !password) {
    return res.status(400).json({ error: 'First name, phone, and password required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const activationCode = uuidv4();
  const keeperCode = generateKeeperCode(); // e.g., SK25A7X9C2M

  try {
    await pool.query('BEGIN');

    const result = await pool.query(  
      `INSERT INTO shopkeepers 
         (keeper_code, first_name, last_name, phone, email, password_hash, activation_code, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING keeper_code, first_name, phone, email`,
      [keeperCode, first_name, last_name, phone, email, hashedPassword, activationCode, false, false]
    );

    await pool.query('COMMIT');

    console.log(`Activation code for ${phone}: ${activationCode}`);

    res.status(201).json({
      message: 'Account created. Please verify using the code sent to your phone.',
      keeper_code: result.rows[0].keeper_code,
      phone: result.rows[0].phone
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    if (err.constraint === 'shopkeepers_phone_key') {
      return res.status(400).json({ error: 'Phone already registered' });
    }
    console.error(err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// GET: Get a single shopkeeper by keeper_code
router.get('/:keeper_code',  authenticateShop, async (req, res) => {
  const { keeper_code } = req.params;

  if (!keeper_code) {
    return res.status(400).json({ error: 'Shopkeeper code is required' });
  }

  try {
    const result = await pool.query(
      `SELECT 
         k.keeper_code,
         k.first_name,
         k.last_name,
         k.phone,
         k.email,
         k.is_active,
         k.created_at AS keeper_created_at,
         s.shop_id,
         s.name AS shop_name,
         s.phone AS shop_phone,
         s.email AS shop_email,
         s.address AS shop_address,
         s.created_at AS shop_created_at
       FROM shopkeepers k
       LEFT JOIN shops s ON k.shop_id = s.shop_id
       WHERE k.keeper_code = $1`,
      [keeper_code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shopkeeper not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching shopkeeper:', err);
    res.status(500).json({ error: 'Could not fetch shopkeeper' });
  }
});

// GET /api/v1/shopkeepers?phone=+254712345678
router.get('/',  authenticateShop, async (req, res) => {
  const { phone } = req.query;

  let queryText = `
    SELECT k.keeper_code, k.first_name, k.last_name, k.phone, s.name AS shop_name
    FROM shopkeepers k
    LEFT JOIN shops s ON k.shop_id = s.shop_id
  `;
  const values = [];

  if (phone) {
    queryText += ' WHERE k.phone = $1';
    values.push(phone);
  } else {
    queryText += ' ORDER BY k.first_name';
  }

  try {
    const result = await pool.query(queryText, values);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch shopkeepers' });
  }
});

// GET: Get all shopkeepers (owner-only)
router.get('/', authenticateShop,  async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        k.keeper_code,
        k.first_name,
        k.last_name,
        k.phone,
        k.email,
        k.is_active,
        k.created_at AS keeper_created_at,
        s.shop_id,
        s.name AS shop_name,
        s.phone AS shop_phone,
        s.email AS shop_email,
        s.address AS shop_address,
        s.created_at AS shop_created_at
      FROM shopkeepers k
      LEFT JOIN shops s ON k.shop_id = s.shop_id
      ORDER BY s.name NULLS FIRST, k.first_name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching all shopkeepers:', err);
    res.status(500).json({ error: 'Could not fetch shopkeepers' });
  }
});

// POST: Verify account
router.post('/verify', authenticateShop, async (req, res) => {
  const { phone, code } = req.body;

  try {
    const result = await pool.query(
      `UPDATE shopkeepers
       SET is_verified = TRUE, is_active = TRUE
       WHERE phone = $1 AND activation_code = $2 AND is_verified = FALSE
       RETURNING keeper_id, first_name, phone`,
      [phone, code]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    res.json({ message: 'Account verified successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST: Login
router.post('/login', authenticateShop, async (req, res) => {
  const { phone, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT 
         k.keeper_code,
         k.first_name,
         k.is_active,
         k.password_hash,           -- ✅ ADD THIS LINE
         s.shop_id,
         s.name AS shop_name,
         s.api_key
       FROM shopkeepers k
       LEFT JOIN shops s ON k.shop_id = s.shop_id
       WHERE k.phone = $1`,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // 🔐 Now this will work because password_hash is included
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account not active' });
    }

    res.json({
      keeper_code: user.keeper_code,
      first_name: user.first_name,
      shop_id: user.shop_id || null,
      shop_name: user.shop_name || null,
      api_key: user.api_key || null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router; 