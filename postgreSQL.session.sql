-- =============================================
--  SHOP MANAGEMENT SYSTEM - FULL SCHEMA
--  PostgreSQL
--  Flow: Shopkeeper (signup) → Activate → Create Shop → Add Products → Record Sales
-- =============================================

-- 🔐 Enable UUID extension (for secure codes)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- 1. shopkeepers - Staff/Users (signup first)
-- =============================================
CREATE TABLE shopkeepers (
  keeper_id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  phone TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  shop_id INTEGER, -- NULL at signup, filled when shop is created
  activation_code UUID UNIQUE, -- For email/SMS verification
  is_active BOOLEAN DEFAULT FALSE, -- Must verify to activate
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_shopkeepers_phone ON shopkeepers(phone);
CREATE INDEX idx_shopkeepers_email ON shopkeepers(email);
CREATE INDEX idx_shopkeepers_shop ON shopkeepers(shop_id);
CREATE INDEX idx_shopkeepers_activation ON shopkeepers(activation_code);

-- =============================================
-- 2. shops - The Store (created after signup)
-- =============================================
CREATE TABLE shops (
  shop_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  api_key TEXT UNIQUE NOT NULL DEFAULT ('live_' || uuid_generate_v4()::TEXT),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link shopkeepers.shop_id → shops.shop_id
ALTER TABLE shopkeepers 
ADD CONSTRAINT fk_keeper_shop 
FOREIGN KEY (shop_id) REFERENCES shops(shop_id) ON DELETE SET NULL;

-- =============================================
-- 3. product_types - Base Product (e.g., Chicken)
-- =============================================
CREATE TABLE product_types (
  type_id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (shop_id) REFERENCES shops(shop_id) ON DELETE CASCADE
);

-- Index
CREATE INDEX idx_product_types_shop ON product_types(shop_id);

-- =============================================
-- 4. product_variants - Specific Size/Price
-- =============================================
CREATE TABLE product_variants (
  variant_id SERIAL PRIMARY KEY,
  type_id INTEGER NOT NULL,
  shop_id INTEGER NOT NULL,
  size DECIMAL,
  size_unit TEXT,
  unit TEXT NOT NULL, -- how it's sold: 'kg', 'piece', etc.
  price_per_unit DECIMAL NOT NULL,
  current_stock DECIMAL NOT NULL DEFAULT 0,
  barcode TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (type_id) REFERENCES product_types(type_id) ON DELETE CASCADE,
  FOREIGN KEY (shop_id) REFERENCES shops(shop_id) ON DELETE CASCADE,
  CONSTRAINT unique_barcode_per_shop UNIQUE (barcode, shop_id)
);

-- Indexes
CREATE INDEX idx_product_variants_type ON product_variants(type_id);
CREATE INDEX idx_product_variants_shop ON product_variants(shop_id);
CREATE INDEX idx_product_variants_barcode ON product_variants(barcode);

-- =============================================
-- 5. sales - Recorded Transactions
-- =============================================
CREATE TABLE sales (
  sale_id BIGSERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity DECIMAL NOT NULL,
  unit_price DECIMAL NOT NULL,
  total_price DECIMAL NOT NULL,
  sale_date TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (shop_id) REFERENCES shops(shop_id) ON DELETE CASCADE,
  FOREIGN KEY (variant_id) REFERENCES product_variants(variant_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_sales_shop_date ON sales(shop_id, sale_date);
CREATE INDEX idx_sales_variant ON sales(variant_id);

-- =============================================
-- ✅ SAMPLE DATA
-- =============================================

-- 1. Insert a shopkeeper (signup)
-- Activation code: use uuid_generate_v4() or set manually
INSERT INTO shopkeepers (
  first_name, last_name, phone, email, password_hash, role, activation_code, is_active, is_verified
) VALUES (
  'John',
  'Omondi',
  '+254700123456',
  'john@sunbake.com',
  '$2b$10$VEsCdfLqOq90k6w5q9v7pOHaZ5u1JZtQJZz8yZz1Y6v6u2q4v8q2O', -- bcrypt hash of "password123"
  'owner',
  uuid_generate_v4(), -- random activation code
  FALSE,
  FALSE
) RETURNING activation_code;
-- Save this activation_code to send via SMS/email

-- 2. After verification, create shop
-- Update shopkeeper and create shop in one flow
WITH new_shop AS (
  INSERT INTO shops (name, phone, email, address)
  VALUES (
    'SunBake Bakery',
    '+254700123456',
    'info@sunbake.com',
    '123 Main St, Nairobi'
  )
  RETURNING shop_id
)
UPDATE shopkeepers 
SET 
  shop_id = (SELECT shop_id FROM new_shop),
  is_active = TRUE,
  is_verified = TRUE
WHERE phone = '+254700123456';

-- 3. Insert product types (now that shop exists)
INSERT INTO product_types (shop_id, name, brand, category, description) VALUES
  (1, 'Chicken', 'FarmFresh', 'Meat', 'Fresh farm chicken'),
  (1, 'Bread', 'SunBake', 'Bakery', 'Soft white bread'),
  (1, 'Milk', 'Nido', 'Dairy', 'Pasteurized full-cream milk'),
  (1, 'Solder Wire', 'Phillips', 'Electronics', 'Rosin-core solder'),
  (1, 'Soap', 'Dove', 'Toiletries', 'Moisturizing bar');

-- 4. Insert product variants
INSERT INTO product_variants 
  (type_id, shop_id, size, size_unit, unit, price_per_unit, current_stock, barcode) 
VALUES
  -- Chicken
  (1, 1, 0.5, 'kg', 'kg', 160.00, 8, 'CHICKEN500G'),
  (1, 1, 1.0, 'kg', 'kg', 300.00, 5, 'CHICKEN1KG'),
  (1, 1, 2.0, 'kg', 'kg', 550.00, 3, 'CHICKEN2KG'),
  -- Bread
  (2, 1, 400, 'g', 'piece', 45.00, 10, 'BREAD400G'),
  (2, 1, 600, 'g', 'piece', 65.00, 7, 'BREAD600G'),
  (2, 1, 800, 'g', 'piece', 80.00, 4, 'BREAD800G'),
  -- Milk
  (3, 1, 0.5, 'litre', 'litre', 100.00, 12, 'MILK500ML'),
  (3, 1, 1.0, 'litre', 'litre', 180.00, 6, 'MILK1L'),
  -- Solder
  (4, 1, 5, 'metre', 'metre', 700.00, 15, 'SOLDER5M'),
  (4, 1, 10, 'metre', 'metre', 1300.00, 8, 'SOLDER10M'),
  -- Soap
  (5, 1, 100, 'g', 'piece', 75.00, 20, 'SOAP100G'),
  (5, 1, 150, 'g', 'piece', 105.00, 15, 'SOAP150G');

-- 5. Insert sample sales
INSERT INTO sales (shop_id, variant_id, quantity, unit_price, total_price, sale_date) VALUES
  (1, 1, 0.5, 160.00, 80.00, '2025-04-01 09:30:00'),
  (1, 5, 1, 65.00, 65.00, '2025-04-01 10:15:00'),
  (1, 7, 2, 180.00, 360.00, '2025-04-01 11:20:00'),
  (1, 9, 3, 130.00, 390.00, '2025-04-01 14:00:00'),
  (1, 12, 1, 105.00, 105.00, '2025-04-01 16:45:00');

-- =============================================
-- 🎯 VERIFY DATA
-- =============================================

-- Check shopkeeper
SELECT * FROM shopkeepers WHERE phone = '+254700123456';

-- Check shop
SELECT * FROM shops;

-- Check products + variants
SELECT 
  pt.name, pt.brand, pv.size, pv.size_unit, pv.price_per_unit, pv.current_stock
FROM product_types pt
JOIN product_variants pv ON pt.type_id = pv.type_id
WHERE pt.shop_id = 1;

-- Check sales
SELECT * FROM sales WHERE shop_id = 1;






-- Remove role column
ALTER TABLE shopkeepers DROP COLUMN IF EXISTS role;

-- Add keeper_code (e.g., MP2025A8X9Z)
ALTER TABLE shopkeepers ADD COLUMN keeper_code TEXT UNIQUE NOT NULL DEFAULT (
  'SK' || 
  EXTRACT(YEAR FROM NOW())::TEXT || 
  UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 5))
);

-- Update default
ALTER TABLE shopkeepers ALTER COLUMN keeper_code DROP DEFAULT;
-- We'll generate it in code instead



SELECT * FROM shopkeepers
SELECT * FROM shops
SELECT * FROM product_types
SELECT * FROM product_variants
SELECT * FROM sales

DELETE  FROM product_variants;
DELETE  FROM product_types;
DELETE  FROM sales
DELETE  FROM shopkeepers
DELETE  FROM shops



-- Add soft delete columns
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Ensure unique size per product
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'uk_type_size'
          AND conrelid = 'product_variants'::regclass
    ) THEN
        ALTER TABLE product_variants 
        ADD CONSTRAINT uk_type_size UNIQUE (type_id, size, size_unit);
    END IF;
END $$;

-- Index for soft delete
CREATE INDEX IF NOT EXISTS idx_product_types_active ON product_types(shop_id, is_active);
CREATE INDEX IF NOT EXISTS idx_product_variants_active ON product_variants(type_id, is_active);


ALTER TABLE shopkeepers
ADD COLUMN due_date TIMESTAMPTZ,
ADD COLUMN plan_type VARCHAR(10);-- 'daily', 'weekly', 'monthly'
