const express = require('express');
const router = express.Router()
const Booking = require('../models/booking');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Get a persoms bookings
router.get('/', (req, res, next) => { 
    res.status(200).json({message: "Handling get request to /bookings"})
}) 

// Get a particular booking
router.get('/:bookingId', async (req, res, next) => {
    const booking = await Booking.findOne({ id: req.params.bookingId });
    if (!booking) return res.status(404).json({ error: "slot not found" });
    res.status(200).json(booking);
})

// book a slot
router.post('/', async (req, res, next) => {
    const { slot_id, name, email } = req.body;
    slot_id = slot_id.trim() || "";
    name = name.trim() || "";
    email = email.trim().toLowerCase() || "";

    if (!slot_id || !name || !email || !EMAIL_RE.test(email)) {
        return (res.status(400).json({
            error: "slot_id, name and a valid email are required"
        }))
    }
    const slot_to_book = await slots.findOne({ _id: slot_id });
    if(!slot_to_book) { 
        return (res.status(404).json({
            error: "slot not found" 
        }))
    };
    if (slot.startMs <= Date.now()) {
        return (res.status(400).json({
            error: "slot has already started" 
        }))
    }
    const booking = new Booking({
        id: new mongoose.Types.ObjectId(),
        slot_id: slot_id,
        name: name,
        status: "confirmed",
        created_at: new Date()
    });
    try {
        const result = await Booking.create(booking);
        return (
            res.status(201).json({
                status: 'confirmed',
                booking: result
            })
        );
    } catch (e) {
        if (e.code === 11000) return res.status(409).json({error: "Slot already booked"});
        throw e;
    }
}) 

// delete a booking
router.delete("/:bookingId", async (req, res, next) => {
    const id = req.params.bookingId;
    const deleted_booking = await Booking.findByIdAndUpdate(id, { status: 'cancelled' }, { new: true });
    if (!deleted_booking || deleted_booking == null) {
        return res.status(404).json({ error: "slot not found" });
    }
    res.status(200).json(deleted_booking)
})

module.exports = router;