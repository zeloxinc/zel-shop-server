// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import routes
const productRoutes = require('./routers/products');
const shopkeeperRoutes = require('./routers/shopkeepers');
const shopRoutes = require('./routers/shops');
const saleRoutes = require('./routers/sales');

// Create app
const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/shopkeepers', shopkeeperRoutes);
app.use('/api/v1/shops', shopRoutes);
app.use('/api/v1/sales', saleRoutes);

// Port
const PORT = process.env.PORT || 5000;

// Start server
app.listen(PORT, () => {
  console.log(`🟢 Server running on http://localhost:${PORT}`);
});