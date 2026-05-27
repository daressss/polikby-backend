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

app.set('trust proxy', 1);

app.use(cors({
    origin: 'https://polikby.vercel.app',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'super_secret_key_for_clinic_app_2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

app.use(getUserInfo);

app.use('/api/auth', authRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/medical-history', medicalHistoryRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server running' });
});

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
