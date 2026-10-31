const db = require('../config/db');
const ingestionService = require('../services/ingestionService');

const transactionController = {
  getTransactions: async (req, res) => {
    try {
      const list = await db.getTransactions();
      res.json(list);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  addManualTransaction: async (req, res) => {
    try {
      const { amount, payee, category } = req.body;
      const tx = await ingestionService.ingestTransaction({
        amount: -Math.abs(Number(amount)), // manual entries are debits
        payee,
        category,
        source: 'manual',
        occurredAt: new Date().toISOString()
      });
      res.status(201).json(tx);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  simulateNotification: async (req, res) => {
    try {
      const { smsText } = req.body;
      if (!smsText) {
        return res.status(400).json({ error: "smsText is required" });
      }
      const tx = await ingestionService.processNotificationSMS(smsText);
      res.status(201).json(tx);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  simulateAA: async (req, res) => {
    try {
      const { amount, payee, occurredAt } = req.body;
      // Account Aggregator (AA) transaction simulation
      const tx = await ingestionService.ingestTransaction({
        amount: -Math.abs(Number(amount)),
        payee,
        source: 'aa',
        occurredAt: occurredAt || new Date().toISOString(),
        rawText: `AA Link: UPI transaction of ${amount} to ${payee}`
      });
      res.status(201).json(tx);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  resolveDuplicate: async (req, res) => {
    try {
      const { id } = req.params;
      const { keepBoth } = req.body;
      const result = await ingestionService.resolveDuplicate(id, keepBoth);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateTransaction: async (req, res) => {
    try {
      const { id } = req.params;
      const updated = await db.updateTransaction(id, req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getRules: async (req, res) => {
    try {
      const rules = await db.getRules();
      res.json(rules);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  addRule: async (req, res) => {
    try {
      const { pattern, category, resolvedMerchant } = req.body;
      const rule = await db.addRule({ pattern, category, resolvedMerchant });
      res.status(201).json(rule);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  clearAllTransactions: async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;
      await db.clearAllTransactions(userId);
      res.json({ success: true, message: 'All transactions cleared.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = transactionController;
