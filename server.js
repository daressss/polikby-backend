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

// Доверять заголовкам от прокси (Railway)
app.set('trust proxy', 1);

// CORS - разрешаем запросы с вашего фронтенда
const allowedOrigins = [
    'https://polikby.vercel.app',
    'https://polikby-frontend.vercel.app',
    'https://polikby-git-main-daressss1.vercel.app',
    'http://localhost:3000'
];

app.use(cors({
    origin: function(origin, callback) {
        // Разрешаем запросы без origin (например, от curl) и из разрешенных источников
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.log('Blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session - настройки для продакшена (исправлено для мобильных устройств)
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,           // Обязательно true для HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 часа
        sameSite: 'none',       // Разрешить кросс-доменные запросы
        domain: '.vercel.app'   // Домен для всех поддоменов vercel.app
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

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({
        success: false,
        message: err.message || 'Внутренняя ошибка сервера'
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
