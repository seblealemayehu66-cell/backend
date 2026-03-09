import express from "express";
import axios from "axios";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

/* ================= PRICE CACHE ================= */

let cachedPrices = {};
let lastFetch = 0;

/* ===== FETCH LIVE PRICES ===== */

async function fetchPrices() {
  try {
    const [cryptoRes, goldRes, silverRes] = await Promise.all([
      axios.get("https://api.coingecko.com/api/v3/simple/price", {
        params: {
          ids: "bitcoin,ethereum,solana",
          vs_currencies: "usd",
        },
      }),

      axios.get("https://www.goldapi.io/api/XAU/USD", {
        headers: { "x-access-token": process.env.GOLD_API_KEY },
      }),

      axios.get("https://www.goldapi.io/api/XAG/USD", {
        headers: { "x-access-token": process.env.GOLD_API_KEY },
      }),
    ]);

    const prices = {
      BTC: cryptoRes.data.bitcoin.usd,
      ETH: cryptoRes.data.ethereum.usd,
      SOL: cryptoRes.data.solana.usd,
      USDT: 1,
      XAU: goldRes.data.price,
      XAG: silverRes.data.price,
    };

    cachedPrices = prices;
    lastFetch = Date.now();

    console.log("Prices Updated:", prices);
  } catch (err) {
    console.error("Price Fetch Error:", err.message);
  }
}

/* ===== AUTO UPDATE PRICES EVERY 60s ===== */

setInterval(fetchPrices, 60000);

/* ===== INITIAL FETCH WHEN SERVER STARTS ===== */

fetchPrices();

/* ================= SWAP ================= */

router.post("/swap", authMiddleware, async (req, res) => {
  try {
    const { fromAsset, toAsset } = req.body;
    const amount = Number(req.body.amount);

    if (!fromAsset || !toAsset || !amount)
      return res.status(400).json({ message: "Missing data" });

    if (fromAsset === toAsset)
      return res.status(400).json({ message: "Cannot swap same asset" });

    if (amount <= 0)
      return res.status(400).json({ message: "Invalid amount" });

    const user = await User.findById(req.user.id);

    if (!user)
      return res.status(404).json({ message: "User not found" });

    if (!user.balance[fromAsset] || user.balance[fromAsset] < amount)
      return res.status(400).json({ message: "Insufficient balance" });

    const prices = cachedPrices;

    if (!prices[fromAsset] || !prices[toAsset])
      return res.status(400).json({ message: "Invalid asset" });

    /* ===== UNIVERSAL CONVERSION ===== */

    const usdValue = amount * prices[fromAsset];
    const receiveAmount = usdValue / prices[toAsset];

    user.balance[fromAsset] -= amount;
    user.balance[toAsset] =
      (user.balance[toAsset] || 0) + receiveAmount;

    await user.save();

    res.json({
      success: true,
      received: receiveAmount,
      rate: prices[fromAsset] / prices[toAsset],
      balance: user.balance,
      prices,
      lastUpdate: lastFetch,
    });

  } catch (err) {
    console.error("Swap Error:", err.message);
    res.status(500).json({ message: "Swap failed" });
  }
});

export default router;
