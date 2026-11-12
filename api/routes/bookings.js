const express = require('express');
const router = express.Router()
const Booking = require('../models/booking');
const Slot = require('../models/slot');
const Idempotency = require('../models/idempotency');
const Attempt = require('../models/attempt');
const crypto = require('crypto')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function format(b) {
    return {
        id: b._id.toString(),
        slot_id: b.slot_id,
        name: b.name,
        email: b.email,
        status: b.status,
        created_at: b.created_at
    };
}

// Get a persoms bookings
router.get('/', async (req, res, next) => { 
    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    if (!email) {
        return res.status(400).json({ error: 'email is required' });
    }
    try {
        let limit = 10;
        if (req.query.limit !== undefined) {
            if (typeof req.query.limit !== 'string' || !/^\d+$/.test(req.query.limit)) {
                return res.status(400).json({ error: 'limit must be a whole number from 1 to 50' });
            }
            limit = Number(req.query.limit);
            if (limit < 1 || limit > 50) {
                return res.status(400).json({ error: 'limit must be a whole number from 1 to 50' });
            }
        }

        const filter = { email };
        if (req.query.cursor) {
            if (typeof req.query.cursor !== 'string' || !OBJECT_ID_RE.test(req.query.cursor)) {
                return res.status(400).json({ error: 'invalid cursor' });
            }
            filter._id = { $gt: req.query.cursor }; // only bookings created after the cursor
        }

        // Ask for one extra row to know whether another page exists
        const rows = await Booking.find(filter).sort({ _id: 1 }).limit(limit + 1);
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const next_cursor = hasMore ? page[page.length - 1]._id.toString() : null;

        return res.status(200).json({ bookings: page.map(format), next_cursor });
    } catch (error) {
        next(error)
    }
}) 

// Get a particular booking
router.get('/:bookingId', async (req, res, next) => {
    try {
        if (!OBJECT_ID_RE.test(req.params.bookingId)) {
            return res.status(404).json({ error: 'booking not found' });
        }
        const booking = await Booking.findById(req.params.bookingId);
        if (!booking) {
            return res.status(404).json({ error: 'booking not found' });
        }
        return res.status(200).json(format(booking));
    } catch (err) {
        next(err);
    }
})

async function createBooking(body) {
    const slot_id = typeof body.slot_id === 'string' ? body.slot_id.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (email) {
        const mine = await Attempt.create({ email });
        const recent = await Attempt.find({
            email,
            at: { $gt: new Date(Date.now() - 60000) }
        }).sort({ at: 1, _id: 1 });

        const myPosition = recent.findIndex((a) => a._id.equals(mine._id));
        if (myPosition >= 5) {
            await Attempt.deleteOne({ _id: mine._id }); // rejected tries don't extend the wait
            const wait = Math.ceil((recent[0].at.getTime() + 60000 - Date.now()) / 1000);
            return {
                status: 429,
                retryAfter: Math.max(wait, 1),
                body: { error: 'too many attempts, please slow down' }
            };
        }
    }

    if (!slot_id || !name || !email || !EMAIL_RE.test(email)) {
        return { status: 400, body: { error: 'slot_id, name and a valid email are required' } };
    }

    const slot = await Slot.findById(slot_id);
    if (!slot) {
        return { status: 404, body: { error: 'slot not found' } };
    }
    if (slot.startMs <= Date.now()) {
        return { status: 400, body: { error: 'slot has already started' } };
    }

    try {
        const booking = await Booking.create({ slot_id, name, email });
        return { status: 201, body: format(booking) };
    } catch (err) {
        if (err.code === 11000) {
            return { status: 409, body: { error: 'slot already booked' } };
        }
        throw err;
    }
}

// book a slot
router.post('/', async (req, res, next) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const key = req.header('Idempotency-Key');

        if (key) {
            const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
            try {
                await Idempotency.create({ key, hash });
            } catch (err) {
                if (err.code !== 11000) throw err;
                // We've seen this key before.
                let old = await Idempotency.findOne({ key });
                // If the first request is still running, wait up to ~5 seconds for it to finish
                for (let i = 0; i < 50 && old && !old.done && old.hash === hash; i++) {
                    await sleep(100);
                    old = await Idempotency.findOne({ key });
                }
                if (!old) {
                    return res.status(409).json({ error: 'please retry' });
                }
                if (old.hash !== hash) {
                    return res.status(422).json({ error: 'Idempotency-Key was used with a different body' });
                }
                if (old.done) {
                    return res.status(old.status).json(old.body); // replay the saved answer
                }
                return res.status(409).json({ error: 'request still in progress, retry shortly' });
            }
        }

        let result;
        try {
            result = await createBooking(body);
        } catch (err) {
            if (key) await Idempotency.deleteOne({ key });
            throw err;
        }

        if (key) {
            if (result.status === 429) {
                await Idempotency.deleteOne({ key }); // don't remember rate-limit answers
            } else {
                await Idempotency.updateOne(
                    { key },
                    { done: true, status: result.status, body: result.body }
                );
            }
        }

        if (result.retryAfter) {
            res.set('Retry-After', String(result.retryAfter));
        }
        return res.status(result.status).json(result.body);
    } catch (error) {
        next(error);
    }
}) 

// delete a booking
router.delete("/:bookingId", async (req, res, next) => {
    try {
        // if (!OBJECT_ID_RE.test(req.params.id)) {
        //     return res.status(404).json({ error: 'booking not found' });
        // }
        const booking = await Booking.findByIdAndUpdate(
            req.params.bookingId,
            { status: 'cancelled' },
            { new: true }
        );
        if (!booking) {
            return res.status(404).json({ error: 'booking not found' });
        }
        return res.status(200).json(format(booking));
    } catch (err) {
        next(err);
    }
})

module.exports = router;