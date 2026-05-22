const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Get all doctors (public)
router.get('/', async (req, res) => {
    const { specialization } = req.query;

    try {
        let query = `
            SELECT d.*,
                   (SELECT COUNT(*) FROM appointments a
                    WHERE a.doctor_id = d.id
                      AND a.appointment_date >= CURDATE()
                      AND a.status = 'booked') as upcoming_count
            FROM doctors d
        `;
        let params = [];

        if (specialization) {
            query += ' WHERE d.specialization = ?';
            params.push(specialization);
        }

        query += ' ORDER BY d.specialization, d.full_name';

        const [doctors] = await pool.execute(query, params);
        res.json({ success: true, doctors });
    } catch (error) {
        console.error('Error fetching doctors:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки врачей' });
    }
});

// Get specializations
router.get('/specializations', async (req, res) => {
    try {
        const [specializations] = await pool.execute(
            'SELECT DISTINCT specialization FROM doctors ORDER BY specialization'
        );
        res.json({ success: true, specializations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ошибка загрузки специализаций' });
    }
});

// Get doctor by ID
router.get('/:id', async (req, res) => {
    try {
        const [doctors] = await pool.execute(
            'SELECT * FROM doctors WHERE id = ?',
            [req.params.id]
        );

        if (doctors.length === 0) {
            return res.status(404).json({ success: false, message: 'Врач не найден' });
        }

        res.json({ success: true, doctor: doctors[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Ошибка загрузки' });
    }
});

module.exports = router;