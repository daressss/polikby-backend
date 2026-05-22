const express = require('express');
const { requireAuth } = require('../middleware/auth');
const pool = require('../config/database');

const router = express.Router();

// Получить всех пациентов текущего пользователя (сам пользователь + добавленные через added_by_user_id)
router.get('/my', requireAuth, async (req, res) => {
    try {
        console.log('=== GET /my patients ===');
        console.log('User ID:', req.session.userId);

        // 1. Получаем самого пользователя как пациента
        const [selfPatient] = await pool.execute(
            'SELECT id FROM patients WHERE user_id = ?',
            [req.session.userId]
        );

        let patients = [];

        // 2. Добавляем самого пользователя
        if (selfPatient.length > 0) {
            const [self] = await pool.execute(
                `SELECT p.*,
                        'self' as patient_type,
                        (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'booked') as active_appointments
                 FROM patients p
                 WHERE p.id = ?`,
                [selfPatient[0].id]
            );
            patients = self;
            console.log('Self patient found:', self[0]?.full_name);
        }

        // 3. Добавляем пациентов, которых добавил этот пользователь (added_by_user_id = user_id)
        const [addedPatients] = await pool.execute(
            `SELECT p.*,
                    'family' as patient_type,
                    (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id AND a.status = 'booked') as active_appointments
             FROM patients p
             WHERE p.added_by_user_id = ? AND (p.user_id IS NULL OR p.user_id != ?)`,
            [req.session.userId, req.session.userId]
        );

        console.log('Added patients found:', addedPatients.length);

        // Объединяем оба массива
        patients = [...patients, ...addedPatients];

        console.log('Total patients:', patients.length);

        res.json({ success: true, patients });
    } catch (error) {
        console.error('Error fetching patients:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка загрузки пациентов: ' + error.message
        });
    }
});

// Добавить нового пациента (для текущего пользователя)
router.post('/add', requireAuth, async (req, res) => {
    const { full_name, birth_date, address, district_number } = req.body;

    if (!full_name || !birth_date) {
        return res.status(400).json({
            success: false,
            message: 'Заполните обязательные поля (ФИО и дата рождения)'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Проверяем лимит добавленных пациентов
        const [limitCheck] = await connection.execute(
            'SELECT patients_added, max_patients FROM user_patient_limit WHERE user_id = ?',
            [req.session.userId]
        );

        let currentCount = 0;
        let maxPatients = 6;

        if (limitCheck.length > 0) {
            currentCount = limitCheck[0].patients_added;
            maxPatients = limitCheck[0].max_patients;
        }

        if (currentCount >= maxPatients) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: `Вы достигли лимита в ${maxPatients} добавленных пациентов`
            });
        }

        // Проверяем, не существует ли уже такой пациент
        const [existingPatient] = await connection.execute(
            'SELECT id FROM patients WHERE full_name = ? AND birth_date = ?',
            [full_name, birth_date]
        );

        let patientId;

        if (existingPatient.length > 0) {
            patientId = existingPatient[0].id;

            // Проверяем, не добавлен ли уже этот пациент текущим пользователем
            const [alreadyAdded] = await connection.execute(
                'SELECT id FROM patients WHERE id = ? AND added_by_user_id = ?',
                [patientId, req.session.userId]
            );

            if (alreadyAdded.length > 0) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    success: false,
                    message: 'Этот пациент уже добавлен в ваш список'
                });
            }
        } else {
            // Создаем нового пациента (без привязки user_id)
            const [result] = await connection.execute(
                `INSERT INTO patients (full_name, birth_date, address, district_number, added_by_user_id)
                 VALUES (?, ?, ?, ?, ?)`,
                [full_name, birth_date, address || null, district_number || null, req.session.userId]
            );
            patientId = result.insertId;
        }

        // Обновляем счетчик добавленных пациентов
        if (limitCheck.length === 0) {
            await connection.execute(
                `INSERT INTO user_patient_limit (user_id, patients_added, max_patients)
                 VALUES (?, 1, 6)`,
                [req.session.userId]
            );
        } else {
            await connection.execute(
                `UPDATE user_patient_limit
                 SET patients_added = patients_added + 1
                 WHERE user_id = ?`,
                [req.session.userId]
            );
        }

        await connection.commit();
        connection.release();

        res.json({
            success: true,
            message: 'Пациент успешно добавлен',
            patient_id: patientId
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error adding patient:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка добавления пациента: ' + error.message
        });
    }
});

// Удалить пациента из списка
router.delete('/remove/:patientId', requireAuth, async (req, res) => {
    const { patientId } = req.params;

    // Проверяем, не пытается ли пользователь удалить самого себя
    const [selfCheck] = await pool.execute(
        'SELECT id FROM patients WHERE user_id = ? AND id = ?',
        [req.session.userId, patientId]
    );

    if (selfCheck.length > 0) {
        return res.status(400).json({
            success: false,
            message: 'Нельзя удалить самого себя'
        });
    }

    // Проверяем, что пациент был добавлен этим пользователем
    const [patientCheck] = await pool.execute(
        'SELECT id FROM patients WHERE id = ? AND added_by_user_id = ?',
        [patientId, req.session.userId]
    );

    if (patientCheck.length === 0) {
        return res.status(404).json({
            success: false,
            message: 'Пациент не найден в вашем списке'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Удаляем пациента (каскадно удалятся записи appointments через ON DELETE SET NULL)
        await connection.execute('DELETE FROM patients WHERE id = ?', [patientId]);

        // Уменьшаем счетчик в user_patient_limit
        await connection.execute(
            `UPDATE user_patient_limit
             SET patients_added = GREATEST(patients_added - 1, 0)
             WHERE user_id = ?`,
            [req.session.userId]
        );

        await connection.commit();
        connection.release();

        res.json({ success: true, message: 'Пациент удален' });
    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Error removing patient:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка удаления пациента: ' + error.message
        });
    }
});

// Получить информацию о пациенте
router.get('/:patientId', requireAuth, async (req, res) => {
    const { patientId } = req.params;

    try {
        const [patients] = await pool.execute(
            `SELECT p.*,
                    u.username as creator_username,
                    (SELECT COUNT(*) FROM appointments a WHERE a.patient_id = p.id) as total_visits
             FROM patients p
                      LEFT JOIN users u ON p.added_by_user_id = u.id
             WHERE p.id = ?`,
            [patientId]
        );

        if (patients.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Пациент не найден'
            });
        }

        res.json({ success: true, patient: patients[0] });
    } catch (error) {
        console.error('Error fetching patient:', error);
        res.status(500).json({
            success: false,
            message: 'Ошибка загрузки информации'
        });
    }
});

module.exports = router;