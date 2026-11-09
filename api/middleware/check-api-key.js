module.exports = (req, res, next) => {
    if (req.header('X-API-Key') !== process.env.API_KEY) {
        return res.status(401).json({ error: 'invalid or missing API key' });
    }
    next();
};