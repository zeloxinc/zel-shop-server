// routes/shopkeepers.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { authenticateShop } = require('../middleware/auth')

// routes/shopkeepers.js
const { generateKeeperCode } = require('../utils/generatedId');

router.post('/signup', async (req, res) => {
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

// after MPesa confermation
// POST: Verify account and create shop
router.post('/verify', async (req, res) => {
  const { phone, code, shop } = req.body;

  // Validate required fields
  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and verification code are required' });
  }

  if (!shop || !shop.name) {
    return res.status(400).json({ error: 'Shop name is required to create your shop' });
  }

  const { name, phone: shopPhone, email: shopEmail, address } = shop;

  try {
    await pool.query('BEGIN');

    // Step 1: Find unverified shopkeeper
    const keeperResult = await pool.query(
      `SELECT keeper_id, first_name, last_name, email AS keeper_email, keeper_code
       FROM shopkeepers
       WHERE phone = $1 AND activation_code = $2::uuid AND is_verified = FALSE`,
      [phone, code]
    );

    if (keeperResult.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const shopkeeper = keeperResult.rows[0];

    // Step 2: Generate secure API key
    const apiKey = 'live_' + uuidv4();

    // Step 3: Create the shop with user-provided details
    const shopResult = await pool.query(
      `INSERT INTO shops (name, phone, email, address, api_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING shop_id, name, phone, email, address, api_key, created_at`,
      [name, shopPhone || phone, shopEmail, address, apiKey]  // Use keeper's phone if no shop phone
    );

    const createdShop = shopResult.rows[0];

    // Step 4: Link shopkeeper to the new shop and mark as verified & active
    await pool.query(
      `UPDATE shopkeepers
       SET 
         shop_id = $1,
         is_verified = TRUE,
         is_active = TRUE
       WHERE phone = $2`,
      [createdShop.shop_id, phone]
    );

    await pool.query('COMMIT');

    // ✅ Success: Return complete response
    res.json({
      message: 'Account verified and shop created successfully!',
      shopkeeper: {
        keeper_code: shopkeeper.keeper_code,
        first_name: shopkeeper.first_name,
        last_name: shopkeeper.last_name,
        phone: phone,
        email: shopkeeper.keeper_email,
        is_verified: true,
        is_active: true
      },
      shop: createdShop
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    
    // Handle unique constraint errors (e.g., duplicate email or phone)
    if (err.constraint) {
      if (err.constraint.includes('shops_phone_key')) {
        return res.status(400).json({ error: 'A shop with this phone number already exists' });
      }
      if (err.constraint.includes('shops_email_key')) {
        return res.status(400).json({ error: 'A shop with this email already exists' });
      }
    }

    console.error('Verification error:', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
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