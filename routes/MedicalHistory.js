const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Получить историю болезни пациента
router.get('/patient/:patientId', requireAuth, async (req, res) => {
    const { patientId } = req.params;
    console.log('=== GET /medical-history/patient/:patientId ===');
    console.log('Patient ID:', patientId);
    console.log('User ID:', req.session.userId);
    console.log('User Role:', req.session.userRole);

    try {
        // Проверка прав доступа для пациента
        if (req.session.userRole === 'patient') {
            // Проверяем, что пациент принадлежит этому пользователю
            const [access] = await pool.execute(
                `SELECT p.id
                 FROM patients p
                 WHERE p.id = ?
                   AND (p.user_id = ? OR p.added_by_user_id = ?)`,
                [patientId, req.session.userId, req.session.userId]
            );

            if (access.length === 0) {
                console.log('Access denied: patient not found for this user');
                return res.status(403).json({
                    success: false,
                    message: 'Нет доступа к истории другого пациента'
                });
            }
        }

        // Получаем историю болезни
        const [history] = await pool.execute(
            `SELECT mh.*,
                    d.full_name as doctor_name,
                    d.specialization
             FROM medical_history mh
                      JOIN doctors d ON mh.doctor_id = d.id
             WHERE mh.patient_id = ?
             ORDER BY mh.visit_date DESC`,
            [patientId]
        );

        console.log('Medical history found:', history.length);
        res.json({ success: true, history });
    } catch (error) {
        console.error('Error fetching medical history:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка загрузки истории болезни: ' + error.message
        });
    }
});

// Добавить запись в историю болезни (только врач или админ)
router.post('/', requireAuth, requireRole('doctor', 'admin'), async (req, res) => {
    const { patient_id, doctor_id, diagnosis, prescription, visit_date, notes } = req.body;

    if (!patient_id || !visit_date) {
        return res.status(400).json({
            success: false,
            message: 'Заполните обязательные поля'
        });
    }

    let doctorId = doctor_id;
    if (!doctorId && req.session.userRole === 'doctor') {
        const [doctor] = await pool.execute('SELECT id FROM doctors WHERE user_id = ? LIMIT 1', [req.session.userId]);
        if (doctor.length > 0) doctorId = doctor[0].id;
    }

    try {
        await pool.execute(
            `INSERT INTO medical_history (patient_id, doctor_id, diagnosis, prescription, visit_date, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [patient_id, doctorId, diagnosis || null, prescription || null, visit_date, notes || null]
        );

        res.json({
            success: true,
            message: 'Запись добавлена в историю болезни'
        });
    } catch (error) {
        console.error('Error adding medical history:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка добавления записи'
        });
    }
});

module.exports = router;