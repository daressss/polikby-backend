router.post('/register', async (req, res) => {
    console.log('📝 Registration request:', req.body);

    const connection = await pool.getConnection();

    try {
        const { username, password, email, phone, full_name, birth_date, address, district_number } = req.body;

        // Валидация
        if (!username || !password || !full_name || !birth_date) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
        }

        if (password.length < 6) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Пароль должен быть не менее 6 символов' });
        }

        if (username.length < 3) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Логин должен быть не менее 3 символов' });
        }

        // Проверка существующего пользователя
        const [existing] = await connection.execute(
            'SELECT id FROM users WHERE username = ? OR email = ?',
            [username, email || '']
        );

        if (existing.length > 0) {
            connection.release();
            return res.status(400).json({ success: false, message: 'Пользователь с таким логином или email уже существует' });
        }

        await connection.beginTransaction();

        const passwordHash = await bcrypt.hash(password, 10);

        // 1. Создаем пользователя
        const [userResult] = await connection.execute(
            `INSERT INTO users (username, password_hash, email, phone, role) VALUES (?, ?, ?, ?, 'patient')`,
            [username, passwordHash, email || null, phone || null]
        );

        const userId = userResult.insertId;

        // 2. Создаем запись пациента
        const [patientResult] = await connection.execute(
            `INSERT INTO patients (user_id, full_name, birth_date, address, district_number, added_by_user_id) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, full_name, birth_date, address || null, district_number || null, userId]
        );

        const patientId = patientResult.insertId;

        // 3. Добавляем связь в user_patients
        await connection.execute(
            `INSERT INTO user_patients (user_id, patient_id, relationship) VALUES (?, ?, 'self')`,
            [userId, patientId]
        );

        await connection.commit();
        connection.release();

        res.json({ success: true, message: 'Регистрация успешна!' });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Registration error:', error);
        
        // Проверяем, не нарушение ли уникальности
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ success: false, message: 'Пользователь с такими данными уже существует' });
        }
        
        res.status(500).json({ success: false, message: 'Ошибка регистрации: ' + error.message });
    }
});
