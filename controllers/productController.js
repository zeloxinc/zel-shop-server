// controllers/productController.js
const pool = require('../models/db');

// GET: Get all product types + their variants
exports.getProducts = async (req, res) => {
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
      ORDER BY pt.name, pv.size
    `); 

    // Group variants by product type
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
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch products' });
  }
};

// POST: Create a new product type (e.g., "Chicken")
exports.createProductType = async (req, res) => {
  const { name, brand, category, description } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Product name is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO product_types (name, brand, category, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, brand, category, description]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create product' });
  }
};

// POST: Add a variant (size) to existing product
exports.addVariant = async (req, res) => {
  const { type_id } = req.params;
  const { size, size_unit, unit, price_per_unit, current_stock, barcode } = req.body;

  if (!size || !unit || !price_per_unit) {
    return res.status(400).json({ error: 'Size, unit, and price are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO product_variants 
         (type_id, size, size_unit, unit, price_per_unit, current_stock, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [type_id, size, size_unit, unit, price_per_unit, current_stock || 0, barcode]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not add variant' });
  }
};