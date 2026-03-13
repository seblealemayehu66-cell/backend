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
    // Fetch crypto prices from CoinMarketCap
    const cryptoRes = await axios.get(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
      {
        params: { symbol: "BTC,ETH,SOL,USDT" },
        headers: { "X-CMC_PRO_API_KEY": process.env.COINMARKETCAP_API_KEY },
      }
    );

    // Fetch metals from GoldAPI
    const goldRes = await axios.get("https://www.goldapi.io/api/XAU/USD", {
      headers: { "x-access-token": process.env.GOLD_API_KEY },
    });

    const silverRes = await axios.get("https://www.goldapi.io/api/XAG/USD", {
      headers: { "x-access-token": process.env.GOLD_API_KEY },
    });

    // Construct prices
    const prices = {
      BTC: cryptoRes.data.data.BTC.quote.USD.price,
      ETH: cryptoRes.data.data.ETH.quote.USD.price,
      SOL: cryptoRes.data.data.SOL.quote.USD.price,
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
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.balance[fromAsset] || user.balance[fromAsset] < amount)
      return res.status(400).json({ message: "Insufficient balance" });

    const prices = cachedPrices;

    if (!prices[fromAsset] || !prices[toAsset])
      return res.status(400).json({ message: "Invalid asset" });

    /* ===== UNIVERSAL CONVERSION ===== */
    const usdValue = amount * prices[fromAsset];
    const receiveAmount = usdValue / prices[toAsset];

    user.balance[fromAsset] -= amount;
    user.balance[toAsset] = (user.balance[toAsset] || 0) + receiveAmount;

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
