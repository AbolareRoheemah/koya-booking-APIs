const mongoose = require('mongoose');

const idempotencySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    hash: String,
    done: { type: Boolean, default: false },
    status: Number,
    body: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});

module.exports = mongoose.model('Idempotency', idempotencySchema);