const mongoose =  require('mongoose');
const bookingSchema = mongoose.Schema({
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
bookingSchema.index({ email: 1, _id: 1 });

module.exports = mongoose.model('Booking', bookingSchema);