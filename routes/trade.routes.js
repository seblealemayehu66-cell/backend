import express from "express";
import Trade from "../models/Trade.js";
import Settings from "../models/Settings.js";
import User from "../models/User.js";
import authMiddleware from "../middleware/auth.js";

const router = express.Router();

/* ================= RANDOM WIN/LOSS ENGINE ================= */
const getResult = () => {
  return Math.random() > 0.5; // true = win, false = loss
};

/* ================= PLACE TRADE ================= */

router.post("/", authMiddleware, async (req, res) => {
  try {
    let { pair, direction, amount, deliveryTime } = req.body;

    amount = Number(amount);
    deliveryTime = Number(deliveryTime);

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (!user.balance.USDT || amount > user.balance.USDT) {
      return res.status(400).json({ message: "Insufficient USDT balance" });
    }

    // deduct balance
    user.balance.USDT -= amount;
    await user.save();

    const settings = await Settings.findOne();

    let percentage;
    switch (deliveryTime) {
      case 30: percentage = 12; break;
      case 60: percentage = 15; break;
      case 120: percentage = 20; break;
      case 300: percentage = 25; break;
      default: percentage = 15;
    }

    const entryPrice = Number((60000 + Math.random() * 2000).toFixed(2));

    const trade = await Trade.create({
      userId: user._id,
      coin: "USDT",
      pair,
      direction,
      amount,
      entryPrice,
      deliveryTime,
      percentage,
      status: "pending",
      profitLoss: 0,
      result: "pending",
    });

    /* ================= AUTO CLOSE ================= */

    setTimeout(async () => {
  try {
    const t = await Trade.findById(trade._id);
    if (!t || t.status === "closed") return;

    const u = await User.findById(t.userId);
    if (!u) return;

    // ✅ GET FRESH SETTINGS HERE
    const freshSettings = await Settings.findOne();

    let profitLoss = 0;

    if (freshSettings?.tradingOpen) {
      // ✅ ALWAYS WIN
      profitLoss = (t.amount * t.percentage) / 100;
    } else {
      // ❌ ALWAYS LOSE
      profitLoss = -(t.amount * t.percentage) / 100;
    }

    t.profitLoss = profitLoss;
    t.status = "closed";
    t.closedAt = new Date();

    await t.save();

    // update balance
    u.balance.USDT += t.amount + profitLoss;
    await u.save();

  } catch (err) {
    console.error("Auto close error:", err);
  }
}, deliveryTime * 1000);

    /* ================= RESPONSE FIX ================= */

    res.json({
      message: "Trade placed successfully",
      trade: {
        ...trade.toObject(),
        result: "pending",
        profitLoss: 0,
      },
      balance: user.balance,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Trade execution failed" });
  }
});

/* ================= GET TRADES ================= */

router.get("/", authMiddleware, async (req, res) => {
  try {
    const trades = await Trade.find({ userId: req.user._id }).sort({
      createdAt: -1,
    });

    res.json(trades);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch trades" });
  }
});

export default router;
