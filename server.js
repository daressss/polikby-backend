const express = require('express');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

const pool = require('./config/database');
const { getUserInfo } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const doctorRoutes = require('./routes/doctors');
const appointmentRoutes = require('./routes/appointments');
const patientRoutes = require('./routes/patients');
const scheduleRoutes = require('./routes/schedules');
const medicalHistoryRoutes = require('./routes/MedicalHistory');
const adminRoutes = require('./routes/admin');

const app = express();

// CORS
app.use(cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3000', 'https://*.railway.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.use(getUserInfo);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/medical-history', medicalHistoryRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server running' });
});

app.use((err, req, res, next) => {
    // Это выведет полную ошибку в логи Railway!
    console.error('ОШИБКА СЕРВЕРА:', err.stack);
    
    res.status(500).json({
        success: false,
        message: err.message || 'Внутренняя ошибка сервера'
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
