const db = require('../config/db');

const coachingService = {
  getDashboardData: async (userId) => {
    const user = await db.getUser(userId);
    const transactions = await db.getTransactions(userId);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentDay = now.getDate();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const remainingDaysIncludingToday = Math.max(1, daysInMonth - currentDay + 1);
    const remainingDaysAfterToday = Math.max(0, daysInMonth - currentDay);

    // 1. Income & Fixed Obligations
    const income = Number(user.income) || 0;
    const fixedExpenses = Array.isArray(user.fixedExpenses) ? user.fixedExpenses : [];
    const totalFixedExpenses = fixedExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const rawSavingsTarget = Number(user.savingsTarget) || 0;
    const savingsTargetAmount = rawSavingsTarget <= 100 
      ? Math.round((income * rawSavingsTarget) / 100) 
      : rawSavingsTarget;

    // Monthly Discretionary Pool = Income - Fixed Bills (Rent, EMI, etc.) - Savings
    const monthlyDiscretionaryPool = Math.max(0, income - totalFixedExpenses - savingsTargetAmount);
    const baseInitialDailyBudget = Math.round(monthlyDiscretionaryPool / daysInMonth);

    // 2. Filter Current Month's Transactions
    const filteredTx = transactions.filter(tx => {
      const txDate = new Date(tx.occurredAt);
      const isCurrentMonth = txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear;
      return isCurrentMonth && tx.category !== 'duplicate_deleted';
    });

    let needsReviewCount = 0;
    const categorySpent = {
      housing: 0,
      emi: 0,
      bills: 0,
      essentials: 0,
      lifestyle: 0,
      income: 0
    };

    // 3. Identify Fixed Expense Payments (e.g. Rent, EMI paid this month)
    const fixedExpensesStatus = fixedExpenses.map(fe => {
      const feName = (fe.name || '').toLowerCase();
      const matchedTx = filteredTx.find(tx => {
        if (tx.isFixedExpense && tx.fixedExpenseId === fe.id) return true;
        // Auto match if name and approximate amount align
        const payee = (tx.payee || '').toLowerCase();
        const amt = Math.abs(tx.amount);
        const amtMatches = Math.abs(amt - fe.amount) <= 10;
        const nameMatches = (feName.includes('rent') && payee.includes('rent')) ||
                            (feName.includes('emi') && (payee.includes('emi') || payee.includes('loan'))) ||
                            (feName.includes('wifi') && (payee.includes('wifi') || payee.includes('broadband')));
        return amtMatches && nameMatches;
      });

      return {
        ...fe,
        isPaid: fe.isPaid || !!matchedTx,
        paidTxId: matchedTx ? (matchedTx.id || matchedTx._id) : null,
        paidAmount: matchedTx ? Math.abs(matchedTx.amount) : 0
      };
    });

    // 4. Separate Today's Discretionary Spend vs Prior Days
    let spentToday = 0;
    let spentPriorDays = 0;
    let totalSpentMonth = 0;

    for (const tx of filteredTx) {
      if (tx.status === 'needs_review') {
        needsReviewCount++;
      }

      if (tx.amount > 0) {
        categorySpent.income += tx.amount;
      } else {
        const amt = Math.abs(tx.amount);
        totalSpentMonth += amt;

        if (categorySpent[tx.category] !== undefined) {
          categorySpent[tx.category] += amt;
        } else {
          categorySpent.lifestyle += amt;
        }

        // Check if this debit is a planned fixed expense (Rent/EMI)
        const isFixed = tx.isFixedExpense || fixedExpensesStatus.some(fe => fe.paidTxId === (tx.id || tx._id));

        if (!isFixed) {
          const txDate = new Date(tx.occurredAt);
          const isToday = txDate.getDate() === currentDay && 
                          txDate.getMonth() === currentMonth && 
                          txDate.getFullYear() === currentYear;

          if (isToday) {
            spentToday += amt;
          } else if (txDate.getDate() < currentDay) {
            spentPriorDays += amt;
          }
        }
      }
    }

    // Include mid-month onboarded spend (e.g. user joined on Oct 23 and already spent ₹15k)
    const initialMidMonthSpend = (user.onboardingMonth === undefined || user.onboardingMonth === currentMonth) 
      ? (Number(user.alreadySpentThisMonth) || 0) 
      : 0;

    spentPriorDays += initialMidMonthSpend;
    totalSpentMonth += initialMidMonthSpend;

    const totalDiscretionarySpentMonth = spentPriorDays + spentToday;

    // 5. Dynamic Daily Recalibration Math
    // Today's starting budget is remaining discretionary pool at start of day divided by remaining days
    const discretionaryPoolAtStartOfToday = Math.max(0, monthlyDiscretionaryPool - spentPriorDays);
    const dailyTargetToday = Math.max(0, Math.round(discretionaryPoolAtStartOfToday / remainingDaysIncludingToday));
    
    // Remaining available for today
    const leftForToday = dailyTargetToday - spentToday;

    // Remaining pool for the rest of the month if today ends now
    const poolRemainingForTomorrow = Math.max(0, monthlyDiscretionaryPool - totalDiscretionarySpentMonth);
    const projectedTomorrowDailyBudget = remainingDaysAfterToday > 0 
      ? Math.round(poolRemainingForTomorrow / remainingDaysAfterToday) 
      : dailyTargetToday;

    const dailyBudgetDelta = projectedTomorrowDailyBudget - dailyTargetToday;

    // 6. Dynamic Rollover Explanation Message
    let rolloverExplanation = "";
    if (spentToday < dailyTargetToday) {
      const saved = dailyTargetToday - spentToday;
      if (remainingDaysAfterToday > 0) {
        const perDayBonus = Math.abs(dailyBudgetDelta);
        rolloverExplanation = `🔥 You saved ₹${saved.toLocaleString('en-IN')} today! Rolled into the next ${remainingDaysAfterToday} days: tomorrow's daily budget increases by +₹${perDayBonus.toLocaleString('en-IN')} to ₹${projectedTomorrowDailyBudget.toLocaleString('en-IN')}/day.`;
      } else {
        rolloverExplanation = `🔥 You saved ₹${saved.toLocaleString('en-IN')} today! Final day of the month complete.`;
      }
    } else if (spentToday > dailyTargetToday) {
      const overspent = spentToday - dailyTargetToday;
      if (remainingDaysAfterToday > 0) {
        const perDayCut = Math.abs(dailyBudgetDelta);
        rolloverExplanation = `⚠️ Overspent by ₹${overspent.toLocaleString('en-IN')} today. Absorbed across remaining ${remainingDaysAfterToday} days: tomorrow's budget adjusts to ₹${projectedTomorrowDailyBudget.toLocaleString('en-IN')}/day (-₹${perDayCut.toLocaleString('en-IN')}/day) to keep you safe.`;
      } else {
        rolloverExplanation = `⚠️ Overspent by ₹${overspent.toLocaleString('en-IN')} today on the final day.`;
      }
    } else {
      rolloverExplanation = `🎯 Exactly on target! Tomorrow's budget stays steady at ₹${projectedTomorrowDailyBudget.toLocaleString('en-IN')}/day.`;
    }

    // 7. Safe to Spend & Insights
    const monthlyDiscretionaryRemaining = Math.max(0, monthlyDiscretionaryPool - totalDiscretionarySpentMonth);

    const insights = [
      {
        type: 'daily_pace',
        title: 'Daily Floating Allowance',
        percentage: Math.min(100, Math.round((spentToday / (dailyTargetToday || 1)) * 100)),
        label: `${spentToday >= dailyTargetToday ? 'Budget Exhausted' : 'On Track'}`
      },
      {
        type: 'savings',
        title: 'Monthly Savings Target',
        percentage: Math.min(100, Math.round((savingsTargetAmount / (income || 1)) * 100)),
        label: `₹${savingsTargetAmount.toLocaleString('en-IN')} Target`
      }
    ];

    return {
      user: {
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || '',
        profileCompleted: Boolean(user.profileCompleted),
        income,
        savingsTarget: rawSavingsTarget,
        savingsTargetAmount,
        fixedExpenses: fixedExpensesStatus,
        totalFixedExpenses,
        monthlyDiscretionaryPool,
        baseInitialDailyBudget,
        alreadySpentThisMonth: initialMidMonthSpend,
        dailyAllowance: dailyTargetToday, // backwards compat
        goals: Array.isArray(user.goals) ? user.goals : []
      },
      dailyBudget: {
        currentDay,
        daysInMonth,
        remainingDaysIncludingToday,
        remainingDaysAfterToday,
        dailyTargetToday,
        spentToday,
        leftForToday,
        projectedTomorrowDailyBudget,
        dailyBudgetDelta,
        rolloverExplanation
      },
      spending: {
        totalSpent: totalSpentMonth,
        totalDiscretionarySpentMonth,
        monthlyDiscretionaryRemaining,
        categorySpent,
        safeToSpend: monthlyDiscretionaryRemaining
      },
      needsReviewCount,
      insights
    };
  }
};

module.exports = coachingService;
