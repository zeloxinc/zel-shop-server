const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const {
  body,
  param,
  query,
  validationResult
} = require('express-validator');
const { authenticateShop } = require('../middleware/auth');

// 🔐 Utility: Validate and sanitize inputs
const validateCreateProduct = [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 100 }),
  body('brand').optional().trim().isLength({ max: 100 }),
  body('category').optional().trim().isLength({ max: 50 }),
  body('description').optional().trim().isLength({ max: 500 }),
  body('variants').optional().isArray(),
  body('variants.*.size').isNumeric().withMessage('Size must be a number'),
  body('variants.*.size_unit').optional().isLength({ max: 10 }),
  body('variants.*.unit').notEmpty().withMessage('Unit (e.g. piece, kg) is required'),
  body('variants.*.price_per_unit').isNumeric().withMessage('Price must be a number'),
  body('variants.*.current_stock').optional().isNumeric(),
  body('variants.*.barcode').optional().isLength({ max: 50 })
];

const validateCreateVariant = [
  param('type_id').isInt({ gt: 0 }).withMessage('Invalid type ID'),
  body('size').isNumeric().withMessage('Size must be a number'),
  body('unit').trim().notEmpty().withMessage('Unit is required'),
  body('price_per_unit').isNumeric({ min: 0 }).withMessage('Price must be >= 0'),
  body('size_unit').optional().isLength({ max: 10 }),
  body('current_stock').optional().isNumeric({ min: 0 }),
  body('barcode').optional().isLength({ max: 50 })
];

const validateUpdateProduct = [
  param('type_id').isInt({ gt: 0 }).withMessage('Invalid product ID'),
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 100 }),
  body('brand').optional().trim().isLength({ max: 100 }),
  body('category').optional().trim().isLength({ max: 50 }),
  body('description').optional().trim().isLength({ max: 500 })
];

const validateUpdateVariant = [
  param('variant_id').isInt({ gt: 0 }).withMessage('Invalid variant ID'),
  body('size').optional().isNumeric(),
  body('size_unit').optional().isLength({ max: 10 }),
  body('unit').optional().trim().notEmpty(),
  body('price_per_unit').optional().isNumeric({ min: 0 }),
  body('current_stock').optional().isNumeric({ min: 0 }),
  body('barcode').optional().isLength({ max: 50 })
];

// 🔍 Utility: Check if product type exists and belongs to shop
async function productExistsInShop(typeId, shopId) {
  const result = await pool.query(
    'SELECT 1 FROM product_types WHERE type_id = $1 AND shop_id = $2 AND is_active = TRUE',
    [typeId, shopId]
  );
  return result.rows.length > 0;
}

// 🔍 Utility: Check if variant exists and belongs to shop
async function variantExistsInShop(variantId, shopId) {
  const result = await pool.query(
    'SELECT 1 FROM product_variants WHERE variant_id = $1 AND shop_id = $2 AND is_active = TRUE',
    [variantId, shopId]
  );
  return result.rows.length > 0;
}


// PUBLIC / ADMIN: Get products by shop_id (no auth needed)
// Query: /products?shop_id=1&q=bread&category=Bakery&page=1&limit=20
router.get('/', async (req, res) => {
  const {
    shop_id: rawShopId,
    q,
    category,
    page = 1,
    limit = 20
  } = req.query;

  const shopId = rawShopId ? parseInt(rawShopId) : null;

  // Validate shop_id if provided
  if (rawShopId && (isNaN(shopId) || shopId <= 0)) {
    return res.status(400).json({ error: 'Invalid shop_id' });
  }

  // Validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = `
      SELECT 
        pt.type_id, pt.name, pt.brand, pt.category, pt.description,
        pv.variant_id, pv.size, pv.size_unit, pv.unit AS sell_unit,
        pv.price_per_unit, pv.current_stock, pv.barcode
      FROM product_types pt
      LEFT JOIN product_variants pv ON pt.type_id = pv.type_id AND pv.is_active = TRUE
      WHERE pt.is_active = TRUE
    `;
    const conditions = [];
    const values = [];

    if (shopId) {
      conditions.push(`pt.shop_id = $${conditions.length + 1}`);
      values.push(shopId);
    }
    if (q) {
      conditions.push(`pt.name ILIKE '%' || $${conditions.length + 1} || '%'`);
      values.push(q.trim());
    }
    if (category) {
      conditions.push(`pt.category = $${conditions.length + 1}`);
      values.push(category.trim());
    }

    if (conditions.length > 0) {
      query += ' AND ' + conditions.join(' AND ');
    }

    query += ' ORDER BY pt.name, pv.size NULLS FIRST LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2);
    values.push(parseInt(limit), offset);

    const result = await pool.query(query, values);

    // Group by type_id
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

    const products = Object.values(productsMap);

    // Total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT pt.type_id) AS total
      FROM product_types pt
      LEFT JOIN product_variants pv ON pt.type_id = pv.type_id AND pv.is_active = TRUE
      WHERE pt.is_active = TRUE
    `;
    const countConditions = [];
    const countValues = [];

    if (shopId) {
      countConditions.push(`pt.shop_id = $1`);
      countValues.push(shopId);
    }
    if (q) {
      countConditions.push(`pt.name ILIKE '%' || $${countConditions.length + 1} || '%'`);
      countValues.push(q.trim());
    }
    if (category) {
      countConditions.push(`pt.category = $${countConditions.length + 1}`);
      countValues.push(category.trim());
    }

    const countResult = await pool.query(
      countQuery + (countConditions.length ? ' AND ' + countConditions.join(' AND ') : ''),
      countValues
    );
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      data: products,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_items: total,
        items_per_page: parseInt(limit)
      }
    });
  } catch (err) {
    console.error('Error fetching products:', err);
    res.status(500).json({ error: 'Could not fetch products' });
  }
});


// AUTH: Get single product with variants
router.get('/:type_id', authenticateShop, validateUpdateProduct, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { type_id } = req.params;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(`
      SELECT 
        pt.type_id, pt.name, pt.brand, pt.category, pt.description,
        pv.variant_id, pv.size, pv.size_unit, pv.unit AS sell_unit,
        pv.price_per_unit, pv.current_stock, pv.barcode
      FROM product_types pt
      LEFT JOIN product_variants pv ON pt.type_id = pv.type_id AND pv.is_active = TRUE
      WHERE pt.type_id = $1 AND pt.shop_id = $2 AND pt.is_active = TRUE
    `, [type_id, shopId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = {
      type_id: result.rows[0].type_id,
      name: result.rows[0].name,
      brand: result.rows[0].brand,
      category: result.rows[0].category,
      description: result.rows[0].description,
      variants: []
    };

    result.rows.forEach(row => {
      if (row.variant_id) {
        product.variants.push({
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

    res.json(product);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch product' });
  }
});


// AUTH: Create new product type (with optional variants)
router.post('/', authenticateShop, validateCreateProduct, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, brand, category, description, variants } = req.body;
  const shopId = req.shop.shop_id;

  try {
    // Start transaction
    await pool.query('BEGIN');

    const productResult = await pool.query(
      `INSERT INTO product_types (shop_id, name, brand, category, description, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING type_id`,
      [shopId, name, brand, category, description]
    );

    const typeId = productResult.rows[0].type_id;

    // Insert variants if provided
    const createdVariants = [];
    if (variants && variants.length > 0) {
      for (const v of variants) {
        const variantResult = await pool.query(
          `INSERT INTO product_variants 
             (type_id, shop_id, size, size_unit, unit, price_per_unit, current_stock, barcode, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
           RETURNING *`,
          [
            typeId,
            shopId,
            v.size,
            v.size_unit,
            v.unit,
            v.price_per_unit,
            v.current_stock || 0,
            v.barcode || null
          ]
        );
        createdVariants.push(variantResult.rows[0]);
      }
    }

    await pool.query('COMMIT');

    res.status(201).json({
      type_id: typeId,
      name,
      brand,
      category,
      description,
      variants: createdVariants
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error creating product:', err);
    res.status(500).json({ error: 'Could not create product' });
  }
});

// POST: Create multiple products in one request
router.post('/bulk', authenticateShop, async (req, res) => {
  const products = req.body;
  const shopId = req.shop.shop_id;

  // Validate: must be an array
  if (!Array.isArray(products)) {
    return res.status(400).json({ error: 'Request body must be an array of products' });
  }

  // Validate each product (minimal)
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.name || typeof p.name !== 'string') {
      return res.status(400).json({ error: `Product at index ${i} is missing or invalid 'name'` });
    }
  }

  const results = [];
  const errors = [];

  try {
    // Process each product (not in one transaction — so one failure doesn't kill all)
    for (let i = 0; i < products.length; i++) {
      const p = products[i];

      try {
        // Start transaction per product (to keep variants consistent)
        await pool.query('BEGIN');

        const productResult = await pool.query(
          `INSERT INTO product_types (shop_id, name, brand, category, description, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           RETURNING type_id`,
          [shopId, p.name, p.brand || null, p.category || null, p.description || null]
        );

        const typeId = productResult.rows[0].type_id;
        const createdVariants = [];

        if (p.variants && Array.isArray(p.variants)) {
          for (const v of p.variants) {
            // Validate required variant fields
            if (v.size == null || !v.unit || v.price_per_unit == null) {
              throw new Error('Missing required variant fields: size, unit, or price_per_unit');
            }

            const variantResult = await pool.query(
              `INSERT INTO product_variants 
                 (type_id, shop_id, size, size_unit, unit, price_per_unit, current_stock, barcode, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
               RETURNING variant_id, size, size_unit, unit, price_per_unit, current_stock, barcode`,
              [
                typeId,
                shopId,
                v.size,
                v.size_unit || null,
                v.unit,
                v.price_per_unit,
                v.current_stock || 0,
                v.barcode || null
              ]
            );
            createdVariants.push(variantResult.rows[0]);
          }
        }

        await pool.query('COMMIT');

        results.push({
          index: i,
          type_id: typeId,
          name: p.name,
          variants: createdVariants
        });
      } catch (err) {
        await pool.query('ROLLBACK');
        errors.push({
          index: i,
          name: p.name,
          error: err.message
        });
      }
    }

    // Return success + failures
    return res.status(201).json({
      message: `Bulk create completed: ${results.length} success, ${errors.length} failed`,
      created: results,
      failed: errors
    });
  } catch (err) {
    console.error('Bulk create failed:', err);
    return res.status(500).json({ error: 'Internal server error during bulk create' });
  }
});


// AUTH: Update product type
router.put('/:type_id', authenticateShop, validateUpdateProduct, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { type_id } = req.params;
  const { name, brand, category, description } = req.body;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `UPDATE product_types
       SET name = $1, brand = $2, category = $3, description = $4
       WHERE type_id = $5 AND shop_id = $6 AND is_active = TRUE
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


// AUTH: Add variant to product
router.post('/:type_id/variants', authenticateShop, validateCreateVariant, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { type_id } = req.params;
  const { size, size_unit, unit, price_per_unit, current_stock, barcode } = req.body;
  const shopId = req.shop.shop_id;

  try {
    // Verify product exists and belongs to shop
    if (!(await productExistsInShop(type_id, shopId))) {
      return res.status(403).json({ error: 'Product not found or access denied' });
    }

    const result = await pool.query(
      `INSERT INTO product_variants 
         (type_id, shop_id, size, size_unit, unit, price_per_unit, current_stock, barcode, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING *`,
      [type_id, shopId, size, size_unit, unit, price_per_unit, current_stock || 0, barcode || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add variant' });
  }
});


// AUTH: Update variant
router.put('/variants/:variant_id', authenticateShop, validateUpdateVariant, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { variant_id } = req.params;
  const { size, size_unit, unit, price_per_unit, current_stock, barcode } = req.body;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `UPDATE product_variants
       SET size = $1, size_unit = $2, unit = $3, price_per_unit = $4,
           current_stock = $5, barcode = $6
       WHERE variant_id = $7 AND shop_id = $8 AND is_active = TRUE
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


// AUTH: Soft delete variant
router.delete('/variants/:variant_id', authenticateShop, async (req, res) => {
  const { variant_id } = req.params;
  const shopId = req.shop.shop_id;

  try {
    const result = await pool.query(
      `UPDATE product_variants
       SET is_active = FALSE
       WHERE variant_id = $1 AND shop_id = $2 AND is_active = TRUE
       RETURNING *`,
      [variant_id, shopId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Variant not found or already deleted' });
    }

    res.json({ message: 'Variant deactivated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete variant' });
  }
});


// AUTH: Soft delete product type (and variants via trigger or cascade logic)
router.delete('/:type_id', authenticateShop, async (req, res) => {
  const { type_id } = req.params;
  const shopId = req.shop.shop_id;

  try {
    await pool.query('BEGIN');

    // First, deactivate variants
    await pool.query(
      'UPDATE product_variants SET is_active = FALSE WHERE type_id = $1 AND shop_id = $2',
      [type_id, shopId]
    );

    // Then deactivate product type
    const result = await pool.query(
      'UPDATE product_types SET is_active = FALSE WHERE type_id = $1 AND shop_id = $2 AND is_active = TRUE RETURNING *',
      [type_id, shopId]
    );

    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Product not found or already deleted' });
    }

    await pool.query('COMMIT');
    res.json({ message: 'Product and its variants deactivated successfully' });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not delete product' });
  }
});

module.exports = router;