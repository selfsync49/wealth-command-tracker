require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./config/db');

const userController = require('./controllers/userController');
const transactionController = require('./controllers/transactionController');
const authController = require('./controllers/authController');
const { protect } = require('./middleware/authMiddleware');

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
// Authentication (Google & Demo)
app.post('/api/auth/google-login', authController.googleLogin);
app.post('/api/auth/demo-login', authController.demoLogin);
app.get('/api/auth/me', protect, authController.getMe);

// User and Dashboard (protected — requires JWT)
app.get('/api/user', protect, userController.getUser);
app.put('/api/user', protect, userController.updateUser);
app.get('/api/dashboard', protect, userController.getDashboard);

// Transactions (protected)
app.get('/api/transactions', protect, transactionController.getTransactions);
app.post('/api/transactions/manual', protect, transactionController.addManualTransaction);
app.post('/api/transactions/simulate-sms', protect, transactionController.simulateNotification);
app.post('/api/transactions/simulate-aa', protect, transactionController.simulateAA);
app.post('/api/transactions/resolve-duplicate/:id', protect, transactionController.resolveDuplicate);
app.put('/api/transactions/:id', protect, transactionController.updateTransaction);
app.delete('/api/transactions/all', protect, transactionController.clearAllTransactions);

// Rules (protected)
app.get('/api/rules', protect, transactionController.getRules);
app.post('/api/rules', protect, transactionController.addRule);

// Simple Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    database: db.isMongooseActive() ? 'mongoose' : 'json-fallback',
    timestamp: new Date()
  });
});

// Connect database then start Express server
db.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Wealth Command Backend running on http://localhost:${PORT}`);
    console.log(`📡 Health endpoint: http://localhost:${PORT}/health`);
  });
});
