const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const { handleRequest } = require('../src/controllers/mainController');
const { handleExport } = require('../src/controllers/exportController');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));

// Routing
app.post('/api', handleRequest);
app.get('/api/export', handleExport);

// Serve static files in local development
if (process.env.NODE_ENV !== 'production') {
  const path = require('path');
  app.use('/css', express.static(path.join(__dirname, '../css')));
  app.use('/js', express.static(path.join(__dirname, '../js')));
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
  });
  app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(__dirname, '../logo.png'));
  });
}

// Khởi chạy server local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  });
}

// Export cho Vercel Serverless
module.exports = app;