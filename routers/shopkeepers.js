// routes/shopkeepers.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

// POST: Signup (create shopkeeper)
router.post('/signup', async (req, res) => {
  const { first_name, last_name, phone, email, password } = req.body;

  if (!first_name || !phone || !password) {
    return res.status(400).json({ error: 'First name, phone, and password required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const activationCode = uuidv4();

  try {
    await pool.query('BEGIN');

    const result = await pool.query(
      `INSERT INTO shopkeepers 
         (first_name, last_name, phone, email, password_hash, activation_code, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING keeper_id, first_name, phone, email`,
      [first_name, last_name, phone, email, hashedPassword, activationCode, false, false]
    );

    await pool.query('COMMIT');

    // 📲 In real app: send activationCode via SMS/email
    console.log(`Activation code for ${phone}: ${activationCode}`);

    res.status(201).json({
      message: 'Account created. Please verify using the code sent to your phone.',
      keeper_id: result.rows[0].keeper_id
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

// GET: Get current shopkeeper's profile
router.get('/single', async (req, res) => {
  const shopkeeperId = req.shop.keeper_id;

  try {
    const result = await pool.query(
      `SELECT 
         k.keeper_id,
         k.first_name,
         k.last_name,
         k.phone,
         k.email,
         k.role,
         k.is_active,
         s.shop_id,
         s.name AS shop_name,
         s.phone AS shop_phone,
         s.email AS shop_email,
         s.address AS shop_address
       FROM shopkeepers k
       LEFT JOIN shops s ON k.shop_id = s.shop_id
       WHERE k.keeper_id = $1`,
      [shopkeeperId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Shopkeeper not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching shopkeeper:', err);
    res.status(500).json({ error: 'Could not fetch profile' });
  }
});

// GET: Get all shopkeepers (owner-only)
router.get('/', async (req, res) => {
  const requestingRole = req.shop.role;
  const shopId = req.shop.shop_id;

  // 🔒 Only 'owner' can view all shopkeepers
  if (requestingRole !== 'owner') {
    return res.status(403).json({ error: 'Access denied. Owners only.' });
  }

  try {
    const result = await pool.query(
      `SELECT 
         keeper_id,
         first_name,
         last_name,
         phone,
         email,
         role,
         is_active,
         created_at
       FROM shopkeepers
       WHERE shop_id = $1
       ORDER BY role, first_name`,
      [shopId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching shopkeepers:', err);
    res.status(500).json({ error: 'Could not fetch shopkeepers' });
  }
});

// POST: Verify account
router.post('/verify', async (req, res) => {
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
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT 
         k.keeper_id, k.first_name, k.role, k.is_active,
         s.shop_id, s.name AS shop_name, s.api_key
       FROM shopkeepers k
       LEFT JOIN shops s ON k.shop_id = s.shop_id
       WHERE k.phone = $1`,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account not active' });
    }

    res.json({
      keeper_id: user.keeper_id,
      first_name: user.first_name,
      role: user.role,
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