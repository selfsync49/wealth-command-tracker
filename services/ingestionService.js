const db = require('../config/db');

/**
 * Normalizes and parses incoming UPI push notifications and SMS.
 * Extracts:
 * - Amount
 * - Payee / Merchant Name
 * - Credit vs Debit
 * - Source App (GPay, PhonePe, Paytm, CRED, BHIM, Bank SMS)
 */
function parseNotification(text) {
  // Strip comma separators for easy float parsing
  const cleanText = text.replace(/,/g, '');

  // 1. Detect Source App
  let detectedApp = "UPI Notification";
  if (/gpay|google\s*pay/i.test(cleanText)) detectedApp = "Google Pay";
  else if (/phonepe/i.test(cleanText)) detectedApp = "PhonePe";
  else if (/paytm/i.test(cleanText)) detectedApp = "Paytm";
  else if (/cred/i.test(cleanText)) detectedApp = "CRED";
  else if (/bhim/i.test(cleanText)) detectedApp = "BHIM";
  else if (/hdfc|sbi|icici|axis|kotak|bank/i.test(cleanText)) detectedApp = "Bank SMS";

  // 2. Extract Amount: matches ₹450, Rs. 1250, INR 300.50, "450 paid"
  const amountRegex = /(?:rs\.?|inr|₹)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|₹)/i;
  const matchAmount = cleanText.match(amountRegex);
  const amountVal = matchAmount ? parseFloat(matchAmount[1] || matchAmount[2]) : 0;

  // 3. Determine credit vs debit
  const isCredit = /received|credited|refunded|recv/i.test(cleanText) && !/debited|paid|spent|sent|transfer to/i.test(cleanText);
  const amount = isCredit ? amountVal : -amountVal;

  // 4. Extract Payee/Merchant name
  let payee = "UPI Merchant";
  const payeePatterns = [
    /(?:paid to|to|at|transfer to|spent at|sent to)\s+([a-z0-9\s\.\-_&]+?)(?:\s+via|\s+from|\s+using|\s+on|\s+at|\s+successfully|\.|$)/i,
    /([a-z0-9\s\.\-_&]+?)\s+(?:credited|debited|received)/i
  ];

  for (const pattern of payeePatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const blacklisted = /^(hdfc|sbi|icici|axis|kotak|gpay|google pay|paytm|phonepe|cred|bhim|upi|bank|rs|inr|card|account|a\/c)$/i;
      if (candidate.length > 1 && !blacklisted.test(candidate)) {
        payee = candidate;
        break;
      }
    }
  }

  return {
    amount,
    payee,
    detectedApp,
    rawText: text
  };
}

/**
 * Service to process incoming transaction payloads from UPI Notifications, Manual entry, or AA
 */
const ingestionService = {
  processNotificationSMS: async (smsText) => {
    const parsed = parseNotification(smsText);
    if (parsed.amount === 0) {
      throw new Error("Unable to parse transaction amount from notification text.");
    }

    return await ingestionService.ingestTransaction({
      amount: parsed.amount,
      payee: parsed.payee,
      source: 'notification',
      rawText: parsed.rawText,
      occurredAt: new Date().toISOString()
    });
  },

  ingestTransaction: async (txData) => {
    const user = await db.getUser();
    const rules = await db.getRules();
    const fixedExpenses = user.fixedExpenses || [];

    let resolvedMerchant = txData.payee;
    let resolvedCategory = 'lifestyle';
    let matchedRule = false;
    let isFixedExpense = false;
    let fixedExpenseId = null;

    // 1. Check if this payment matches a planned Big Fixed Expense (Rent, EMI, etc.)
    const lowerPayee = (txData.payee || '').toLowerCase();
    const lowerRaw = (txData.rawText || '').toLowerCase();
    const absAmount = Math.abs(txData.amount);

    for (const fe of fixedExpenses) {
      const feName = (fe.name || '').toLowerCase();
      const amountMatches = Math.abs(absAmount - fe.amount) <= 10;
      
      const nameMatches = 
        (feName.includes('rent') && (lowerPayee.includes('rent') || lowerRaw.includes('rent') || lowerPayee.includes('landlord'))) ||
        (feName.includes('emi') && (lowerPayee.includes('emi') || lowerRaw.includes('emi') || lowerPayee.includes('loan'))) ||
        (feName.includes('wifi') && (lowerPayee.includes('wifi') || lowerRaw.includes('wifi') || lowerPayee.includes('broadband')));

      if (nameMatches || (amountMatches && fe.amount >= 2000 && (lowerPayee.includes('rent') || lowerPayee.includes('emi') || lowerPayee.includes('loan')))) {
        isFixedExpense = true;
        fixedExpenseId = fe.id;
        resolvedMerchant = fe.name;
        resolvedCategory = fe.category || 'housing';
        break;
      }
    }

    // 2. Categorization Rules Matching (if not already matched to fixed expense)
    if (!isFixedExpense) {
      for (const rule of rules) {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(txData.payee) || (txData.rawText && regex.test(txData.rawText))) {
          resolvedMerchant = rule.resolvedMerchant;
          resolvedCategory = rule.category;
          matchedRule = true;
          break;
        }
      }
    }

    // Treat credits as 'income'
    if (txData.amount > 0) {
      resolvedCategory = 'income';
    }

    // 3. Duplicate Detection Engine
    const existingTransactions = await db.getTransactions();
    const now = new Date(txData.occurredAt || Date.now());
    
    let duplicateOf = null;
    for (const existing of existingTransactions) {
      const timeDiffMs = Math.abs(new Date(existing.occurredAt) - now);
      const isWithinTimeWindow = timeDiffMs <= 3600 * 1000; // 1 hour
      
      const amountDiff = Math.abs(Math.abs(existing.amount) - Math.abs(txData.amount));
      const isSameAmount = amountDiff < 0.05;

      if (isWithinTimeWindow && isSameAmount && existing.source !== txData.source) {
        duplicateOf = existing;
        break;
      }
    }

    let status = 'confirmed';
    if (duplicateOf) {
      status = 'needs_review';
    } else if (!matchedRule && !isFixedExpense && txData.amount < 0) {
      status = 'needs_review';
    }

    const transactionToSave = {
      amount: txData.amount,
      payee: resolvedMerchant,
      category: resolvedCategory,
      source: txData.source,
      status: status,
      isFixedExpense,
      fixedExpenseId,
      occurredAt: txData.occurredAt || new Date().toISOString(),
      rawText: txData.rawText || `${txData.source.toUpperCase()} captured spend`,
      dedupKey: duplicateOf ? (duplicateOf.id || duplicateOf._id.toString()) : null
    };

    const savedTx = await db.addTransaction(transactionToSave);

    if (duplicateOf) {
      await db.updateTransaction(duplicateOf.id || duplicateOf._id.toString(), {
        status: 'needs_review',
        dedupKey: savedTx.id || savedTx._id.toString()
      });
    }

    return savedTx;
  },

  resolveDuplicate: async (id, keepBoth) => {
    const transactions = await db.getTransactions();
    const targetTx = transactions.find(t => (t.id || t._id.toString()) === id);
    if (!targetTx) throw new Error("Transaction not found");

    if (keepBoth) {
      await db.updateTransaction(id, { status: 'confirmed', dedupKey: null });
      if (targetTx.dedupKey) {
        await db.updateTransaction(targetTx.dedupKey, { status: 'confirmed', dedupKey: null });
      }
      return { message: "Kept both transactions." };
    } else {
      const peerTx = transactions.find(t => (t.id || t._id.toString()) === targetTx.dedupKey);
      
      let toDelete = null;
      let toConfirm = null;

      if (targetTx.source === 'notification') {
        toDelete = targetTx;
        toConfirm = peerTx;
      } else {
        toDelete = peerTx;
        toConfirm = targetTx;
      }

      if (toConfirm) {
        await db.updateTransaction(toConfirm.id || toConfirm._id.toString(), {
          status: 'confirmed',
          dedupKey: null
        });
      }

      if (toDelete) {
        await db.updateTransaction(toDelete.id || toDelete._id.toString(), {
          status: 'confirmed',
          category: 'duplicate_deleted',
          dedupKey: null
        });
      }

      return { message: "Successfully merged duplicate transaction. Retained AA record." };
    }
  }
};

module.exports = ingestionService;
module.exports.parseNotification = parseNotification;
