const express = require('express');
const router = express.Router()
const Slot = require('../models/slot');
const mongoose = require('mongoose');
const Booking = require('../models/booking');

router.get('/', async (req, res, next) => {
    filter = req.query.provider ? { provider: req.query.provider } : {};
    const slots = await Slot.find(filter).sort({ startMs: 1 }).toArray();
    const booked = Booking.distinct('slot_id', { status: 'confirmed' })
    res.status(200).json({
        slots: slots.map(slot => ({
            id: slot.id, 
            provider: slot.provider, 
            start: slot.start, 
            end: slot.end,
            available: !booked.has(slot.id),
        }))
    })
}) 

router.post('/', (req, res, next) => {
    const slot = new Slot({
        id: new mongoose.Types.ObjectId(),
        provider: req.body.provider,
        start: req.body.start,
        end: req.body.end
    });
    slot.save()
    .then(result => {
        res.status(201).json({
            message: "Handling POST request to /slots",
            slot: result
        })
    })
    .catch(err => {
        res.status(500).json({error: err})
    })
})

module.exports = router;