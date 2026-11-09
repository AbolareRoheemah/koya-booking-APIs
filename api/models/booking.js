const mongoose =  require('mongoose');
const bookingSchema = mongoose.Schema({
    id: mongoose.Schema.Types.ObjectId,
    slot_id: {type: String, required: true},
    name: String,
    email: String,
    status: {type: String, default: 'confirmed'},
    created_at: {type: Date, default: Date.now}
})

bookingSchema.index(
    { slot_id: 1 },
    { unique: true, partialFilterExpression: { status: 'confirmed' } }
);

module.exports = mongoose.model('Booking', bookingSchema);