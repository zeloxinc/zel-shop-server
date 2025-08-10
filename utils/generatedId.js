// utils/generateId.js
function generateKeeperCode() {
  const year = new Date().getFullYear().toString().slice(-2); // '25'
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let rand = '';
  for (let i = 0; i < 5; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `SK${year}${rand}`; // e.g., SK25A7X9C2M
}

// Ensure unique (you can retry if duplicate)
module.exports = { generateKeeperCode };