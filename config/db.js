const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Fallback JSON DB configuration
const FALLBACK_DB_PATH = path.join(__dirname, '../db_fallback.json');

// Default initial state for DB
const DEFAULT_DB_STATE = {
  user: {
    id: "usr-default-1",
    name: "",
    email: "",
    phone: "",
    profileCompleted: false,
    profileImage: "",
    googleId: "",
    income: 0,
    savingsTarget: 0,
    alreadySpentThisMonth: 0,
    onboardingMonth: new Date().getMonth(),
    onboardingYear: new Date().getFullYear(),
    fixedExpenses: [],
    categoryAllocations: {
      housing: 0,
      essentials: 0,
      lifestyle: 0
    },
    goals: []
  },
  transactions: [],
  rules: [
    { id: "rule-1", pattern: "zomato", category: "lifestyle", resolvedMerchant: "Zomato" },
    { id: "rule-2", pattern: "swiggy", category: "lifestyle", resolvedMerchant: "Swiggy" },
    { id: "rule-3", pattern: "uber", category: "lifestyle", resolvedMerchant: "Uber" },
    { id: "rule-4", pattern: "ola", category: "lifestyle", resolvedMerchant: "Ola" },
    { id: "rule-5", pattern: "amazon", category: "essentials", resolvedMerchant: "Amazon" },
    { id: "rule-6", pattern: "canteen", category: "lifestyle", resolvedMerchant: "The Bombay Canteen" },
    { id: "rule-7", pattern: "rent|landlord|flat rent", category: "housing", resolvedMerchant: "House Rent" },
    { id: "rule-8", pattern: "emi|loan|bajaj|hdfc loan", category: "emi", resolvedMerchant: "Loan EMI" }
  ]
};

// Ensure fallback DB file exists
function initFallbackDb() {
  if (!fs.existsSync(FALLBACK_DB_PATH)) {
    fs.mkdirSync(path.dirname(FALLBACK_DB_PATH), { recursive: true });
    fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(DEFAULT_DB_STATE, null, 2));
  }
}

// JSON Database Helper Methods
const jsonDb = {
  read: () => {
    initFallbackDb();
    try {
      const data = fs.readFileSync(FALLBACK_DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.error("Error reading JSON fallback DB", e);
      return DEFAULT_DB_STATE;
    }
  },
  write: (data) => {
    try {
      fs.writeFileSync(FALLBACK_DB_PATH, JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      console.error("Error writing JSON fallback DB", e);
      return false;
    }
  }
};

let useMongoose = false;

// Initialize Mongo Schemas
const userSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  profileCompleted: { type: Boolean, default: false },
  profileImage: { type: String, default: '' },
  googleId: { type: String, default: '' },
  income: { type: Number, default: 0 },
  savingsTarget: { type: Number, default: 0 },
  alreadySpentThisMonth: { type: Number, default: 0 },
  onboardingMonth: { type: Number, default: () => new Date().getMonth() },
  onboardingYear: { type: Number, default: () => new Date().getFullYear() },
  fixedExpenses: [{
    id: { type: String },
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: 'bills' },
    dueDay: { type: Number, default: 1 },
    isPaid: { type: Boolean, default: false }
  }],
  categoryAllocations: {
    housing: { type: Number, default: 0 },
    essentials: { type: Number, default: 0 },
    lifestyle: { type: Number, default: 0 }
  },
  goals: [{
    id: { type: String },
    name: { type: String, required: true },
    targetAmount: { type: Number, required: true },
    currentAmount: { type: Number, default: 0 },
    category: { type: String, default: 'safety' },
    targetDate: { type: String, default: '' },
    icon: { type: String, default: '🎯' }
  }]
});

const transactionSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  payee: { type: String, required: true },
  category: { type: String, default: 'lifestyle' }, // housing, emi, bills, essentials, lifestyle, income
  source: { type: String, enum: ['manual', 'notification', 'aa'], default: 'manual' },
  status: { type: String, enum: ['confirmed', 'needs_review'], default: 'confirmed' },
  isFixedExpense: { type: Boolean, default: false },
  fixedExpenseId: { type: String, default: null },
  occurredAt: { type: Date, default: Date.now },
  rawText: { type: String },
  dedupKey: { type: String }
});

const merchantMapSchema = new mongoose.Schema({
  pattern: { type: String, required: true },
  category: { type: String, required: true },
  resolvedMerchant: { type: String, required: true }
});

let UserModel, TransactionModel, MerchantMapModel;

async function connectDb() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127017/wealth_command';
  console.log(`Connecting to MongoDB at: ${mongoUri}`);
  try {
    // 8-second timeout for cloud MongoDB Atlas connection
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 8000
    });
    console.log('✅ Connected to MongoDB successfully.');
    useMongoose = true;

    UserModel = mongoose.model('User', userSchema);
    TransactionModel = mongoose.model('Transaction', transactionSchema);
    MerchantMapModel = mongoose.model('MerchantMap', merchantMapSchema);

    // Bootstrap data if empty
    const userCount = await UserModel.countDocuments();
    if (userCount === 0) {
      await new UserModel(DEFAULT_DB_STATE.user).save();
      await TransactionModel.insertMany(DEFAULT_DB_STATE.transactions);
      await MerchantMapModel.insertMany(DEFAULT_DB_STATE.rules);
      console.log('✅ MongoDB bootstrapped with default data.');
    }
  } catch (err) {
    console.warn(`⚠️ MongoDB connection failed: ${err.message}`);
    console.warn(`🚀 Falling back to JSON database at ${FALLBACK_DB_PATH}`);
    useMongoose = false;
    initFallbackDb();
  }
}

// Unified DB Interface
const db = {
  connect: connectDb,
  isMongooseActive: () => useMongoose,

  // User details
  getUser: async (idOrEmail) => {
    if (useMongoose) {
      let query = {};
      if (idOrEmail) {
        if (typeof idOrEmail === 'string' && idOrEmail.includes('@')) {
          query = { email: idOrEmail };
        } else {
          query = { _id: idOrEmail };
        }
      }
      let user = await UserModel.findOne(query);
      if (!user) {
        user = await UserModel.findOne();
      }
      if (!user) {
        user = await new UserModel(DEFAULT_DB_STATE.user).save();
      }
      return user.toObject();
    } else {
      const state = jsonDb.read();
      return state.user;
    }
  },

  findOrCreateGoogleUser: async ({ email, name, profileImage, googleId }) => {
    if (useMongoose) {
      let user = await UserModel.findOne({ email });
      if (!user) {
        user = await new UserModel({
          email,
          name: name || email.split('@')[0],
          profileImage: profileImage || '',
          googleId: googleId || '',
          income: 0,
          savingsTarget: 0,
          fixedExpenses: [],
          goals: [],
          categoryAllocations: { housing: 0, essentials: 0, lifestyle: 0 }
        }).save();
      } else {
        if (name && !user.name) user.name = name;
        if (profileImage && !user.profileImage) user.profileImage = profileImage;
        if (googleId && !user.googleId) user.googleId = googleId;
        await user.save();
      }
      return user.toObject();
    } else {
      const state = jsonDb.read();
      state.user = {
        ...state.user,
        email,
        name: name || state.user.name || email.split('@')[0],
        profileImage: profileImage || state.user.profileImage,
        googleId: googleId || state.user.googleId
      };
      jsonDb.write(state);
      return state.user;
    }
  },

  updateUser: async (userData, userId) => {
    if (useMongoose) {
      let user = userId 
        ? await UserModel.findById(userId)
        : await UserModel.findOne();
      if (!user) {
        user = new UserModel(userData);
      } else {
        Object.assign(user, userData);
      }
      await user.save();
      return user.toObject();
    } else {
      const state = jsonDb.read();
      state.user = { ...state.user, ...userData };
      jsonDb.write(state);
      return state.user;
    }
  },

  // Transactions
  getTransactions: async (userId) => {
    if (useMongoose) {
      const query = userId ? { userId: String(userId) } : {};
      const list = await TransactionModel.find(query).sort({ occurredAt: -1 });
      return list.map(t => t.toObject());
    } else {
      const state = jsonDb.read();
      return [...state.transactions].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    }
  },

  addTransaction: async (txData) => {
    if (useMongoose) {
      const tx = new TransactionModel(txData);
      await tx.save();
      return tx.toObject();
    } else {
      const state = jsonDb.read();
      const newTx = {
        id: "tx-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        occurredAt: new Date().toISOString(),
        status: 'confirmed',
        ...txData
      };
      state.transactions.push(newTx);
      jsonDb.write(state);
      return newTx;
    }
  },

  updateTransaction: async (id, txData) => {
    if (useMongoose) {
      const tx = await TransactionModel.findByIdAndUpdate(id, txData, { new: true });
      return tx ? tx.toObject() : null;
    } else {
      const state = jsonDb.read();
      const idx = state.transactions.findIndex(t => t.id === id);
      if (idx !== -1) {
        state.transactions[idx] = { ...state.transactions[idx], ...txData };
        jsonDb.write(state);
        return state.transactions[idx];
      }
      return null;
    }
  },

  // Rules / MerchantMaps
  getRules: async () => {
    if (useMongoose) {
      const rules = await MerchantMapModel.find();
      return rules.map(r => r.toObject());
    } else {
      const state = jsonDb.read();
      return state.rules;
    }
  },

  addRule: async (ruleData) => {
    if (useMongoose) {
      const rule = new MerchantMapModel(ruleData);
      await rule.save();
      return rule.toObject();
    } else {
      const state = jsonDb.read();
      const newRule = {
        id: "rule-" + Date.now(),
        ...ruleData
      };
      state.rules.push(newRule);
      jsonDb.write(state);
      return newRule;
    }
  },

  clearAllTransactions: async (userId) => {
    if (useMongoose) {
      const query = userId ? { userId: String(userId) } : {};
      await TransactionModel.deleteMany(query);
    } else {
      const state = jsonDb.read();
      state.transactions = [];
      jsonDb.write(state);
    }
  }
};

module.exports = db;
