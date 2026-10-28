'use strict';
const crypto = require('crypto');

/** Request ID dibuat server-side (nilai dari client tidak dipercaya) dan dikembalikan lewat header X-Request-ID. */
function requestContext(req, res, next) {
  req.id = `req-${crypto.randomUUID()}`;
  res.setHeader('X-Request-ID', req.id);
  next();
}
module.exports = { requestContext };
