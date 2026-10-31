const db = require('../config/db');
const coachingService = require('../services/coachingService');

const userController = {
  getUser: async (req, res) => {
    try {
      res.json(req.user); // req.user is set by protect middleware
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  updateUser: async (req, res) => {
    try {
      const { income, savingsTarget, fixedExpenses, categoryAllocations, name, phone, profileCompleted, alreadySpentThisMonth, onboardingMonth, onboardingYear } = req.body;
      const updatePayload = {};

      if (income !== undefined) updatePayload.income = Number(income);
      if (savingsTarget !== undefined) updatePayload.savingsTarget = Number(savingsTarget);
      if (alreadySpentThisMonth !== undefined) updatePayload.alreadySpentThisMonth = Math.max(0, Number(alreadySpentThisMonth));
      if (onboardingMonth !== undefined) updatePayload.onboardingMonth = Number(onboardingMonth);
      if (onboardingYear !== undefined) updatePayload.onboardingYear = Number(onboardingYear);
      if (name) updatePayload.name = String(name).trim();
      if (phone !== undefined) updatePayload.phone = String(phone).trim();
      if (profileCompleted !== undefined) updatePayload.profileCompleted = Boolean(profileCompleted);

      if (Array.isArray(fixedExpenses)) {
        updatePayload.fixedExpenses = fixedExpenses.map((fe, idx) => ({
          id: fe.id || `fe-${Date.now()}-${idx}`,
          name: fe.name,
          amount: Number(fe.amount) || 0,
          category: fe.category || 'housing',
          dueDay: Number(fe.dueDay) || 1,
          isPaid: Boolean(fe.isPaid)
        }));
      }

      if (categoryAllocations) {
        updatePayload.categoryAllocations = {
          housing: Number(categoryAllocations.housing) || 0,
          essentials: Number(categoryAllocations.essentials) || 0,
          lifestyle: Number(categoryAllocations.lifestyle) || 0
        };
      }

      if (Array.isArray(req.body.goals)) {
        updatePayload.goals = req.body.goals.map((g, idx) => ({
          id: g.id || `goal-${Date.now()}-${idx}`,
          name: g.name,
          targetAmount: Number(g.targetAmount) || 0,
          currentAmount: Number(g.currentAmount) || 0,
          category: g.category || 'safety',
          targetDate: g.targetDate || '',
          icon: g.icon || '🎯'
        }));
      }

      const userId = req.user._id || req.user.id;
      const updated = await db.updateUser(updatePayload, userId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  getDashboard: async (req, res) => {
    try {
      const userId = req.user._id || req.user.id;
      const dashboardData = await coachingService.getDashboardData(userId);
      res.json(dashboardData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = userController;
