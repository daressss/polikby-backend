const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const bcrypt = require('bcrypt');
const pool = require('../config/database');

const router = express.Router();

// ============================================
// ДАШБОРД - статистика
// ============================================

router.get('/dashboard/stats', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const [todayAppointments] = await pool.execute(
            `SELECT COUNT(*) as count FROM appointments WHERE appointment_date = CURDATE() AND status = 'booked'`
        );
        
        const [activeDoctors] = await pool.execute(
            `SELECT COUNT(*) as count FROM doctors d 
             JOIN users u ON d.user_id = u.id 
             WHERE u.role = 'doctor'`
        );
        
        const [newPatients] = await pool.execute(
            `SELECT COUNT(*) as count FROM patients WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
        
        const [weekAppointments] = await pool.execute(
            `SELECT COUNT(*) as count FROM appointments WHERE appointment_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`
        );
        
        const [doctorLoad] = await pool.execute(
            `SELECT 
                d.id,
                d.full_name,
                d.specialization,
                COUNT(CASE WHEN a.status = 'booked' THEN 1 END) as booked_count,
                COUNT(a.id) as total_slots,
                ROUND(COUNT(CASE WHEN a.status = 'booked' THEN 1 END) / COUNT(a.id) * 100, 0) as load_percent
             FROM doctors d
             LEFT JOIN appointments a ON d.id = a.doctor_id AND a.appointment_date >= CURDATE()
             GROUP BY d.id
             ORDER BY load_percent DESC
             LIMIT 10`
        );
        
        const [recentAppointments] = await pool.execute(
            `SELECT 
                a.id,
                a.appointment_time,
                a.status,
                p.full_name as patient_name,
                d.full_name as doctor_name,
                d.specialization
             FROM appointments a
             JOIN doctors d ON a.doctor_id = d.id
             LEFT JOIN patients p ON a.patient_id = p.id
             WHERE a.appointment_date >= CURDATE()
             ORDER BY a.appointment_date, a.appointment_time
             LIMIT 10`
        );
        
        res.json({
            success: true,
            stats: {
                todayAppointments: todayAppointments[0].count,
                activeDoctors: activeDoctors[0].count,
                newPatients: newPatients[0].count,
                weekAppointments: weekAppointments[0].count
            },
            doctorLoad,
            recentAppointments
        });
    } catch (error) {
        console.error('Error loading dashboard stats:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки статистики' });
    }
});

// ============================================
// УПРАВЛЕНИЕ ВРАЧАМИ
// ============================================

router.get('/doctors', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const [doctors] = await pool.execute(
            `SELECT d.*, u.username, u.email, u.phone, u.last_login,
                    (SELECT COUNT(*) FROM appointments a WHERE a.doctor_id = d.id AND a.appointment_date >= CURDATE() AND a.status = 'booked') as today_appointments
             FROM doctors d
             LEFT JOIN users u ON d.user_id = u.id
             ORDER BY d.id`
        );
        res.json({ success: true, doctors });
    } catch (error) {
        console.error('Error fetching doctors:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки врачей' });
    }
});

// ============================================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// ============================================

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT u.*, 
                    CASE 
                        WHEN u.role = 'patient' THEN (SELECT p.full_name FROM patients p WHERE p.user_id = u.id LIMIT 1)
                        WHEN u.role = 'doctor' THEN (SELECT d.full_name FROM doctors d WHERE d.user_id = u.id LIMIT 1)
                        ELSE u.username
                    END as full_name
             FROM users u
             ORDER BY u.created_at DESC`
        );
        res.json({ success: true, users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки пользователей' });
    }
});

// Сброс пароля пользователя
router.post('/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const newPassword = Math.random().toString(36).slice(-8);
    
    try {
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id]);
        
        res.json({ success: true, message: 'Пароль сброшен', new_password: newPassword });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ success: false, message: 'Ошибка сброса пароля' });
    }
});

// Смена роли пользователя
router.put('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    
    if (!['patient', 'doctor', 'admin'].includes(role)) {
        return res.status(400).json({ success: false, message: 'Некорректная роль' });
    }
    
    try {
        await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
        res.json({ success: true, message: 'Роль изменена' });
    } catch (error) {
        console.error('Error changing role:', error);
        res.status(500).json({ success: false, message: 'Ошибка изменения роли' });
    }
});

// ============================================
// ОТЧЕТЫ
// ============================================

router.get('/reports/appointments', requireAuth, requireRole('admin'), async (req, res) => {
    const { start_date, end_date, doctor_id } = req.query;
    
    try {
        let query = `
            SELECT 
                DATE(a.appointment_date) as date,
                d.full_name as doctor_name,
                d.specialization,
                COUNT(*) as total,
                SUM(CASE WHEN a.status = 'booked' THEN 1 ELSE 0 END) as booked,
                SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) as no_show
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE 1=1
        `;
        let params = [];
        
        if (start_date) {
            query += ' AND a.appointment_date >= ?';
            params.push(start_date);
        }
        
        if (end_date) {
            query += ' AND a.appointment_date <= ?';
            params.push(end_date);
        }
        
        if (doctor_id) {
            query += ' AND a.doctor_id = ?';
            params.push(doctor_id);
        }
        
        query += ' GROUP BY DATE(a.appointment_date), a.doctor_id ORDER BY date DESC, d.full_name';
        
        const [report] = await pool.execute(query, params);
        res.json({ success: true, report });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ success: false, message: 'Ошибка генерации отчета' });
    }
});

module.exports = router;
