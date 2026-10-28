'use strict';
const bcrypt = require('bcryptjs');

const hashPassword = (plain, cost = 10) => bcrypt.hash(plain, cost);
const hashPasswordSync = (plain, cost = 10) => bcrypt.hashSync(plain, cost);
const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

// Hash tiruan agar waktu respons login untuk username tak dikenal mirip dengan username valid.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalisation', 8);

module.exports = { hashPassword, hashPasswordSync, verifyPassword, DUMMY_HASH };
