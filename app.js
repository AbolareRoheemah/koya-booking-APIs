require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const slotsRoutes = require('./api/routes/slots');
const bookingsRoutes = require('./api/routes/bookings');
const resetRoutes = require('./api/routes/reset');
const checkApiKey = require('./api/middleware/check-api-key')

const app = express()
// const dns = require('dns');
// dns.setServers(['8.8.8.8', '1.1.1.1']);

mongoose.connect('mongodb://roheemahabo_db_user:' + process.env.MONGODB_PASSWORD + '@ac-cf5p1m2-shard-00-00.21wepeq.mongodb.net:27017,ac-cf5p1m2-shard-00-01.21wepeq.mongodb.net:27017,ac-cf5p1m2-shard-00-02.21wepeq.mongodb.net:27017/?ssl=true&replicaSet=atlas-epyen9-shard-0&authSource=admin');
mongoose.Promise = global.Promise;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json())

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, GET');
        return res.status(200).json({})
    }
    next();
})

app.use(checkApiKey); 
app.use('/slots', slotsRoutes)
app.use('/bookings', bookingsRoutes)
app.use('/reset', resetRoutes)

app.use((req, res, next) => {
    const error = new Error('Not found');
    error.status = 404;
    next(error)
})

app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({
        error: error.message
    })
})

module.exports = app;