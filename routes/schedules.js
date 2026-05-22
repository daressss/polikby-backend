const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Get public schedule
router.get('/public', async (req, res) => {
    try {
        const [schedules] = await pool.execute(
            `SELECT s.*, d.full_name as doctor_name, d.specialization,
                    (SELECT COUNT(*) FROM appointments a WHERE a.schedule_id = s.id AND a.status != 'cancelled') as total_slots,
                 (SELECT COUNT(*) FROM appointments a WHERE a.schedule_id = s.id AND a.status = 'booked') as booked_slots
             FROM schedules s
                 JOIN doctors d ON s.doctor_id = d.id
             WHERE s.work_date >= CURDATE() AND s.is_available = 1
             ORDER BY s.work_date ASC, s.start_time ASC
                 LIMIT 20`
        );
        res.json({ success: true, schedules });
    } catch (error) {
        console.error('Error fetching public schedule:', error);
        res.status(500).json({ success: false, message: 'Ошибка загрузки' });
    }
});

module.exports = router;