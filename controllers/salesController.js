// controllers/salesController.js
const pool = require('../models/db');

exports.uploadSales = async (req, res) => {
  const client = await pool.connect();
  const { sales } = req.body;
  const shopId = req.shop.shop_id;

  if (!Array.isArray(sales)) {
    return res.status(400).json({ error: 'Sales must be an array' });
  }

  try {
    await client.query('BEGIN');

    for (const sale of sales) {
      await client.query(
        `INSERT INTO sales (shop_id, product_id, quantity, total_price, sale_date)
         VALUES ($1, $2, $3, $4, $5)`,
        [shopId, sale.product_id, sale.quantity, sale.total_price, sale.sale_date]
      );
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      received: sales.length,
      message: 'Sales uploaded successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  } finally {
    client.release();
  }
};