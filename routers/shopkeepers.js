// routes/shopkeepers.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { authenticateShop } = require('../middleware/auth')

// routes/shopkeepers.js
const { generateKeeperCode } = require('../utils/generatedId');

// POST /signup
router.post('/signup', async (req, res) => {
  const { first_name, last_name, phone, email, password } = req.body;

  if (!first_name || !phone || !password) {
    return res.status(400).json({ error: 'First name, phone, and password required' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const keeperCode = generateKeeperCode();

  try {
    await pool.query('BEGIN');

    const result = await pool.query(
      `INSERT INTO shopkeepers 
         (keeper_code, first_name, last_name, phone, email, password_hash, is_active, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING keeper_code, first_name, phone, email`,
      [keeperCode, first_name, last_name, phone, email, hashedPassword, false, false]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Account created. Please choose a plan to activate.',
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

// for admin use only
// GET /api/v1/shopkeepers?phone=+254712345678
router.get('/',  async (req, res) => {
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

// for admin use only
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

// POST /verify
router.post('/verify', async (req, res) => {
  const { phone, code } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and code required' });
  }

  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT 
         s.keeper_id, s.first_name, s.last_name, s.email, s.keeper_code,
         s.shop_id, s.due_date, s.plan_type,
         sh.name, sh.phone, sh.email, sh.address, sh.api_key
       FROM shopkeepers s
       LEFT JOIN shops sh ON s.shop_id = sh.shop_id
       WHERE s.phone = $1 AND s.activation_code = $2::uuid
         AND s.is_active = TRUE AND s.due_date > NOW()`,
      [phone, code]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid, expired, or inactive code' });
    }

    const user = result.rows[0];
    await client.query('COMMIT');

    res.json({
      message: 'Verified and active!',
      shopkeeper: {
        keeper_code: user.keeper_code,
        first_name: user.first_name,
        last_name: user.last_name,
        phone,
        email: user.email,
        is_verified: true,
        is_active: true
      },
      shop: user.shop_id ? {
        shop_id: user.shop_id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        address: user.address,
        api_key: user.api_key,
        created_at: user.created_at
      } : null
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Verification failed' });
  } finally {
    client.release();
  }
});

// POST: Login 
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT 
         k.keeper_id,
         k.keeper_code,
         k.first_name,
         k.last_name,
         k.phone,
         k.email,
         k.password_hash,
         k.is_verified,
         k.is_active,
         s.shop_id,
         s.name AS shop_name,
         s.phone AS shop_phone,
         s.email AS shop_email,
         s.address AS shop_address,
         s.api_key,
         s.created_at AS shop_created_at
       FROM shopkeepers k
       LEFT JOIN shops s ON k.shop_id = s.shop_id
       WHERE k.phone = $1`,
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // 🔐 Check password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }



    // ✅ Fully verified — return full data
    res.json({
      message: 'Login successful',
      is_verified: true,
      shopkeeper: {
        keeper_code: user.keeper_code,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        email: user.email,
        is_verified: true,
        role: user.role
      },
      shop: {
        shop_id: user.shop_id,
        name: user.shop_name,
        phone: user.shop_phone,
        email: user.shop_email,
        address: user.shop_address,
        api_key: user.api_key,
        created_at: user.shop_created_at
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router; 