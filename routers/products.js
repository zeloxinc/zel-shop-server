// routes/products.js
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const { authenticateShop } = require('../middleware/auth');

// 🔐 All routes require authentication
router.use(authenticateShop);

// GET: Get all products + variants for this shop
router.get('/', async (req, res) => {
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(`
      SELECT 
        pt.type_id,
        pt.name,
        pt.brand,
        pt.category,
        pt.description,
        pv.variant_id,
        pv.size,
        pv.size_unit,
        pv.unit AS sell_unit,
        pv.price_per_unit,
        pv.current_stock,
        pv.barcode
      FROM product_types pt
      LEFT JOIN product_variants pv ON pt.type_id = pv.type_id
      WHERE pt.shop_id = $1
      ORDER BY pt.name, pv.size
    `, [shopId]);

    const productsMap = {};
    result.rows.forEach(row => {
      if (!productsMap[row.type_id]) {
        productsMap[row.type_id] = {
          type_id: row.type_id,
          name: row.name,
          brand: row.brand,
          category: row.category,
          description: row.description,
          variants: []
        };
      }

      if (row.variant_id) {
        productsMap[row.type_id].variants.push({
          variant_id: row.variant_id,
          size: row.size,
          size_unit: row.size_unit,
          sell_unit: row.sell_unit,
          price_per_unit: row.price_per_unit,
          current_stock: row.current_stock,
          barcode: row.barcode
        });
      }
    });

    res.json(Object.values(productsMap));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch products' });
  }
});

// POST: Create a new product type
router.post('/', async (req, res) => {
  const { name, brand, category, description } = req.body;
  const shopId = req.shop.shop_id;

  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO product_types (shop_id, name, brand, category, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [shopId, name, brand, category, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create product' });
  }
});

// PUT: Update a product type
router.put('/:type_id', async (req, res) => {
  const { type_id } = req.params;
  const { name, brand, category, description } = req.body;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `UPDATE product_types
       SET name = $1, brand = $2, category = $3, description = $4
       WHERE type_id = $5 AND shop_id = $6
       RETURNING *`,
      [name, brand, category, description, type_id, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found or access denied' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update product' });
  }
});

// POST: Add a new variant
router.post('/:type_id/variants', async (req, res) => {
  const { type_id } = req.params;
  const { size, size_unit, unit, price_per_unit, current_stock, barcode } = req.body;
  const shopId = req.shop.shop_id;

  if (!size || !unit || !price_per_unit) {
    return res.status(400).json({ error: 'Size, unit, and price are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO product_variants 
         (type_id, shop_id, size, size_unit, unit, price_per_unit, current_stock, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [type_id, shopId, size, size_unit, unit, price_per_unit, current_stock || 0, barcode]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add variant' });
  }
});

// PUT: Update a variant
router.put('/variants/:variant_id', async (req, res) => {
  const { variant_id } = req.params;
  const { size, size_unit, unit, price_per_unit, current_stock, barcode } = req.body;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `UPDATE product_variants
       SET size = $1, size_unit = $2, unit = $3, price_per_unit = $4,
           current_stock = $5, barcode = $6
       WHERE variant_id = $7 AND shop_id = $8
       RETURNING *`,
      [size, size_unit, unit, price_per_unit, current_stock, barcode, variant_id, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Variant not found or access denied' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update variant' });
  }
});

module.exports = router;