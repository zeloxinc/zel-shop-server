const pool = require('../models/db')
const express = require("express");
const router = express.Router();
const request = require("request");
const { v4: uuidv4 } = require("uuid");
const { getAccessToken } = require('../middleware/auth');
const axios = require('axios');




// POST /initiate-activation
router.post('/initiate-activation', async (req, res) => {
  const { phone, plan } = req.body;

    const cleanPhone = phone.replace(/\D/g, ''); 
    let formattedPhone;

    if (cleanPhone.length === 10 && cleanPhone.startsWith('07')) {
    formattedPhone = `254${cleanPhone.slice(1)}`;
    } else if (cleanPhone.length === 9 && cleanPhone.startsWith('7')) {
    formattedPhone = `254${cleanPhone}`;
    } else if (cleanPhone.length === 12 && cleanPhone.startsWith('254')) {
    formattedPhone = cleanPhone;
    } else {
    return res.status(400).json({ error: 'Invalid phone number format' });
    }

  const plans = { daily: 10, weekly: 65, monthly: 250  };
  if (!plans[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Choose: daily, weekly, monthly' });
  }

  const amount = plans[plan]; 

  try {
    const shopkeeper = await pool.query(
      `SELECT keeper_id FROM shopkeepers WHERE phone = $1`,
      [phone]
    );

    if (shopkeeper.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ✅ Get access token
    const accessToken = await getAccessToken(); // ← Generated here

    const orderId = uuidv4();
    const timestamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 14);
    const password = Buffer.from(
      process.env.BUSINESS_SHORT_CODE + process.env.MPESA_PASSKEY + timestamp
    ).toString("base64");

    // Save temp payment
    await pool.query(
      `INSERT INTO temp_payments (order_id, phone, amount, plan, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, phone, amount, plan, 'pending']
    );

    const callback_url = `${process.env.BASE_CALLBACK_URL}/api/v1/payment/callback/activation/${orderId}`;

    const stkResponse = await axios({
    method: 'POST',
    url: 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
    headers: {
        Authorization: `Bearer ${accessToken}`,
    },
    data: {
        BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: formattedPhone,      // 254711140441
        PartyB: process.env.BUSINESS_SHORT_CODE,
        PhoneNumber: formattedPhone, // 254711140441
        CallBackURL: callback_url,
        AccountReference: `ZELSHOP-${plan.toUpperCase()}`,
        TransactionDesc: `Activate Zelshop - ${plan} Plan`
    }
    });

    if (stkResponse.data.ResponseCode === "0") {
      res.json({
        message: 'STK push sent',
        CheckoutRequestID: stkResponse.data.CheckoutRequestID
      });
    } else {
      res.status(400).json({
        error: 'STK push failed',
        detail: stkResponse.data.ResponseDescription
      });
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment initiation failed' });
  }
});

// POST /callback/activation/:orderId 
router.post('/callback/activation/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const resultCode = req.body.Body?.stkCallback?.ResultCode;
  const metadata = req.body.Body?.stkCallback?.CallbackMetadata?.Item || [];

  try {
    const temp = await pool.query(
      `SELECT * FROM temp_payments WHERE order_id = $1`,
      [orderId]
    );

    if (temp.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (resultCode !== 0) {
      await pool.query(`UPDATE temp_payments SET status = 'failed' WHERE order_id = $1`, [orderId]);
      return res.json({ status: "failed", message: "Payment cancelled or failed" });
    }

    const phone = temp.rows[0].phone;
    const plan = temp.rows[0].plan;

    const plans = {
      daily: 1,
      weekly: 7,
      monthly: 30
    };

    const days = plans[plan];
    const due_date = new Date();
    due_date.setDate(due_date.getDate() + days);

    const activation_code = uuidv4();

    // Update shopkeeper
    await pool.query(
      `UPDATE shopkeepers
       SET activation_code = $1, due_date = $2, plan_type = $3, is_active = TRUE
       WHERE phone = $4`,
      [activation_code, due_date, plan, phone]
    );

    // Mark as paid
    await pool.query(
      `UPDATE temp_payments SET status = 'completed' WHERE order_id = $1`,
      [orderId]
    );

    res.json({ status: "success", activation_code });

  } catch (err) {
    console.error(err);
  }
});




module.exports = router;