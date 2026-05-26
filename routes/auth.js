const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/database');

const router = express.Router();

// Регистрация
router.post('/register', async (req, res) => {
    console.log('📝 Registration request:', req.body);

    const connection = await pool.getConnection();

    try {
        const {
            username, password, email, phone,
            full_name, birth_date, address, district_number
        } = req.body;

        if (!username || !password || !full_name || !birth_date) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Заполните все обязательные поля'
            });
        }

        if (password.length < 6) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Пароль должен быть не менее 6 символов'
            });
        }

        // Check existing user
        const [existing] = await connection.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email || '']
        );

        if (existing.length > 0) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Пользователь уже существует'
            });
        }

        await connection.beginTransaction();

        const passwordHash = await bcrypt.hash(password, 10);

        const [userResult] = await connection.execute(
            `INSERT INTO users (username, password_hash, email, phone, role)
             VALUES (?, ?, ?, ?, 'patient')`,
            [username, passwordHash, email || null, phone || null]
        );

        const userId = userResult.insertId;

        await connection.execute(
            `INSERT INTO patients (user_id, full_name, birth_date, address, district_number, added_by_user_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, full_name, birth_date, address || null, district_number || null, userId]
        );

        // Add to user_patients
        await connection.execute(
            `INSERT INTO user_patients (user_id, patient_id, relationship)
             VALUES (?, ?, 'self')`,
            [userId, userId]
        );

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: 'Регистрация успешна!'
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка регистрации: ' + error.message
        });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [users] = await pool.execute(
            'SELECT * FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Неверные данные'
            });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({
                success: false,
                message: 'Неверные данные'
            });
        }

        await pool.execute(
            'UPDATE users SET last_login = NOW() WHERE id = ?',
            [user.id]
        );

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.userRole = user.role;

        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка входа'
        });
    }
});

// Logout
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true, message: 'Выход выполнен' });
    });
});

// Check session
router.get('/me', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ success: false, message: 'Не авторизован' });
    }

    try {
        const [users] = await pool.execute(
            'SELECT id, username, email, phone, role, created_at, last_login FROM users WHERE id = ?',
            [req.session.userId]
        );

        if (users.length === 0) {
            req.session.destroy();
            return res.status(401).json({ success: false, message: 'Пользователь не найден' });
        }

        res.json({ success: true, user: users[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

module.exports = router;
