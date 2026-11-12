const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema({
    email: { type: String, required: true },
    at: { type: Date, default: Date.now, expires: 120 }
});
attemptSchema.index({ email: 1, at: 1 });

module.exports = mongoose.model('Attempt', attemptSchema);