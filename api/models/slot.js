const mongoose =  require('mongoose');
const slotSchema = mongoose.Schema({
    id: String,
    provider: String,
    start: String,
    end: String,
    startMs: Number
})

module.exports = mongoose.model('Slot', slotSchema);