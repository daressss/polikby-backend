const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Получить доступные талоны
router.get('/available', requireAuth, async (req, res) => {
    const { doctor_id, date } = req.query;

    if (!doctor_id || !date) {
        return res.status(400).json({ success: false, message: 'Не указан врач или дата' });
    }

    try {
        const [slots] = await pool.execute(
            `SELECT a.id, a.ticket_number, a.appointment_time, a.status,
                    d.room_number, d.full_name as doctor_name, d.specialization
             FROM appointments a
                      JOIN doctors d ON a.doctor_id = d.id
             WHERE a.doctor_id = ? AND a.appointment_date = ? AND a.status = 'available'
             ORDER BY a.appointment_time`,
            [doctor_id, date]
        );

        res.json({ success: true, slots });
    } catch (error) {
        console.error('Error fetching slots:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки' });
    }
});

// Бронирование талона
router.post('/book', requireAuth, async (req, res) => {
    const { appointment_id, patient_id } = req.body;

    if (!appointment_id || !patient_id) {
        return res.status(400).json({ success: false, message: 'Не указан талон или пациент' });
    }

    try {
        await pool.execute(
            'CALL book_appointment(?, ?, ?, ?)',
            [appointment_id, patient_id, req.session.userId, req.session.userRole]
        );

        res.json({ success: true, message: 'Талон успешно забронирован' });
    } catch (error) {
        console.error('Booking error:', error);
        res.status(400).json({ success: false, message: error.message || 'Ошибка бронирования' });
    }
});

// Отмена записи
router.post('/cancel', requireAuth, async (req, res) => {
    const { appointment_id } = req.body;

    if (!appointment_id) {
        return res.status(400).json({ success: false, message: 'Не указан талон' });
    }

    try {
        await pool.execute(
            'CALL cancel_appointment(?, ?, ?)',
            [appointment_id, req.session.userId, req.session.userRole]
        );

        res.json({ success: true, message: 'Запись отменена' });
    } catch (error) {
        console.error('Cancellation error:', error);
        res.status(400).json({ success: false, message: error.message || 'Ошибка отмены' });
    }
});

// Получить мои записи (для пациента)
router.get('/my', requireAuth, async (req, res) => {
    try {
        if (req.session.userRole === 'patient') {
            const [patient] = await pool.execute(
                'SELECT id FROM patients WHERE user_id = ?',
                [req.session.userId]
            );

            if (patient.length === 0) {
                return res.json({ success: true, appointments: [] });
            }

            const [appointments] = await pool.execute(
                `SELECT a.*, d.full_name as doctor_name, d.specialization, d.room_number
                 FROM appointments a
                          JOIN doctors d ON a.doctor_id = d.id
                 WHERE a.patient_id = ?
                 ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
                [patient[0].id]
            );
            res.json({ success: true, appointments });
        } else {
            res.json({ success: true, appointments: [] });
        }
    } catch (error) {
        console.error('Error fetching appointments:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки' });
    }
});

// ========== МАРШРУТЫ ДЛЯ ДОКТОРА ==========

// Получить расписание доктора на конкретную дату
// Получить расписание доктора на конкретную дату
router.get('/doctor/schedule', requireAuth, requireRole('doctor'), async (req, res) => {
    const { date } = req.query;

    console.log('=== DOCTOR SCHEDULE ===');
    console.log('Date:', date);
    console.log('User ID:', req.session.userId);

    if (!date) {
        return res.status(400).json({ success: false, message: 'Не указана дата' });
    }

    try {
        const [doctor] = await pool.execute(
            'SELECT id FROM doctors WHERE user_id = ?',
            [req.session.userId]
        );

        if (doctor.length === 0) {
            return res.status(404).json({ success: false, message: 'Врач не найден' });
        }

        const [appointments] = await pool.execute(
            `SELECT a.*,
                    p.id as patient_id,
                    p.full_name as patient_name,
                    p.birth_date,
                    p.address,
                    u.phone
             FROM appointments a
                      LEFT JOIN patients p ON a.patient_id = p.id
                      LEFT JOIN users u ON p.user_id = u.id
             WHERE a.doctor_id = ? AND a.appointment_date = ?
             ORDER BY a.appointment_time`,
            [doctor[0].id, date]
        );

        res.json({ success: true, appointments });
    } catch (error) {
        console.error('Error loading doctor schedule:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки расписания' });
    }
});

// Получить предстоящих пациентов доктора
// Получить предстоящих пациентов доктора
router.get('/doctor/patients/upcoming', requireAuth, requireRole('doctor'), async (req, res) => {
    try {
        const [doctor] = await pool.execute(
            'SELECT id FROM doctors WHERE user_id = ?',
            [req.session.userId]
        );

        if (doctor.length === 0) {
            return res.status(404).json({ success: false, message: 'Врач не найден' });
        }

        const [patients] = await pool.execute(
            `SELECT DISTINCT
                 p.id,
                 p.full_name,
                 p.birth_date,
                 p.address,
                 u.phone,
                 a.appointment_date,
                 a.appointment_time,
                 a.id as appointment_id
             FROM appointments a
                      JOIN patients p ON a.patient_id = p.id
                      LEFT JOIN users u ON p.user_id = u.id
             WHERE a.doctor_id = ?
               AND a.appointment_date >= CURDATE()
               AND a.status = 'booked'
             ORDER BY a.appointment_date ASC, a.appointment_time ASC`,
            [doctor[0].id]
        );

        res.json({ success: true, patients });
    } catch (error) {
        console.error('Error loading upcoming patients:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки пациентов' });
    }
});

// Отметить прием как завершенный
router.post('/complete', requireAuth, requireRole('doctor'), async (req, res) => {
    const { appointment_id } = req.body;

    if (!appointment_id) {
        return res.status(400).json({ success: false, message: 'Не указан ID приема' });
    }

    try {
        await pool.execute(
            'UPDATE appointments SET status = ? WHERE id = ?',
            ['completed', appointment_id]
        );
        res.json({ success: true, message: 'Прием отмечен как завершенный' });
    } catch (error) {
        console.error('Error completing appointment:', error);
        res.status(500).json({ success: false, message: 'Ошибка' });
    }
});

// Отметить пациента как не явившегося
router.post('/no-show', requireAuth, requireRole('doctor'), async (req, res) => {
    const { appointment_id } = req.body;

    if (!appointment_id) {
        return res.status(400).json({ success: false, message: 'Не указан ID приема' });
    }

    try {
        await pool.execute(
            'UPDATE appointments SET status = ? WHERE id = ?',
            ['no_show', appointment_id]
        );
        res.json({ success: true, message: 'Пациент отмечен как не явившийся' });
    } catch (error) {
        console.error('Error marking no-show:', error);
        res.status(500).json({ success: false, message: 'Ошибка' });
    }
});

// Получить историю приемов доктора
router.get('/doctor/history', requireAuth, requireRole('doctor'), async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    console.log('=== DOCTOR HISTORY ===');
    console.log('User ID:', req.session.userId);
    console.log('Limit:', limit, 'Offset:', offset);

    try {
        const [doctor] = await pool.execute(
            'SELECT id FROM doctors WHERE user_id = ?',
            [req.session.userId]
        );

        console.log('Doctor found:', doctor);

        if (doctor.length === 0) {
            return res.status(404).json({ success: false, message: 'Врач не найден' });
        }

        // Преобразуем в числа
        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);

        // Простой запрос без LIMIT для начала
        const [history] = await pool.execute(
            `SELECT a.*, 
                    p.id as patient_id,
                    p.full_name as patient_name,
                    p.birth_date
             FROM appointments a
             JOIN patients p ON a.patient_id = p.id
             WHERE a.doctor_id = ? AND a.status IN ('completed', 'no_show')
             ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
            [doctor[0].id]
        );

        console.log('History records found:', history.length);
        res.json({ success: true, history });
    } catch (error) {
        console.error('Error loading doctor history:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки истории: ' + error.message });
    }
});

module.exports = router;