const pool = require('../config/database');

const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({
            success: false,
            message: 'Необходима авторизация'
        });
    }
    next();
};

const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.session.userRole) {
            return res.status(401).json({
                success: false,
                message: 'Необходима авторизация'
            });
        }

        if (!roles.includes(req.session.userRole)) {
            return res.status(403).json({
                success: false,
                message: 'Недостаточно прав'
            });
        }

        next();
    };
};

const getUserInfo = async (req, res, next) => {
    if (req.session.userId) {
        const [rows] = await pool.execute(
            'SELECT id, username, email, phone, role, created_at, last_login FROM users WHERE id = ?',
            [req.session.userId]
        );
        if (rows.length > 0) {
            req.user = rows[0];
        }
    }
    next();
};

module.exports = { requireAuth, requireRole, getUserInfo };