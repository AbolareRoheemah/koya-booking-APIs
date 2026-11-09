const express = require('express');
const router = express.Router()
const Slot = require('../models/slot');
const Booking = require('../models/booking');
const mongoose = require('mongoose');

router.post('/', async (req, res, next) => {
    const slots = req.body.slots;
    if (!Array.isArray(slots)) return res.status(400).json({ error: "slots must be an array" });
    await Slot.deleteMany({});
    await Booking.deleteMany({});

    const new_slots = slots.map(slot => {
        return {
            _id: slot.id,
            provider: slot.provider,
            start: slot.start,
            end: slot.end,
            startMs: Date.parse(slot.start),
        }
    })
    await Slot.insertMany(new_slots);

    res.status(200).json({ description: "Done" })
})

module.exports = router;