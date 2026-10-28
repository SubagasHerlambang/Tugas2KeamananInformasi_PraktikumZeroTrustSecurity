'use strict';
const { z } = require('zod');
const { SCORE_MIN, SCORE_MAX } = require('./constants');
const { E } = require('./errors');

const idParam = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Format ID tidak valid');
const nimParam = z.string().regex(/^\d{8,20}$/, 'Format NIM tidak valid');
const deviceIdHeader = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/, 'Format device ID tidak valid');

// Zod 4: angka tak hingga/NaN otomatis ditolak; pesan tipe diberikan lewat parameter `error` (tanpa memantulkan nilai input).
const score = z.number({ error: 'Skor harus berupa angka' })
  .min(SCORE_MIN, `Skor minimal ${SCORE_MIN}`)
  .max(SCORE_MAX, `Skor maksimal ${SCORE_MAX}`);

const schemas = {
  login: z.object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(128),
  }).strict(),
  refresh: z.object({ refresh_token: z.string().min(20).max(256) }).strict(),
  serviceToken: z.object({ client_id: z.string().min(1).max(64), client_secret: z.string().min(1).max(256) }).strict(),
  updateScore: z.object({ score }).strict(),
  sync: z.object({
    grade_id: idParam,
    student_nim: nimParam,
    class_id: idParam,
    score,
    term: z.string().regex(/^[0-9]{4}-[A-Z]{3,10}$/, 'Format term tidak valid'),
    version: z.number().int().min(1).max(1_000_000),
  }).strict(),
  finalizeBody: z.object({}).strict().optional().default({}),
};

/** Parse dengan zod; kembalikan data atau lempar AppError 400 yang aman (tanpa memantulkan nilai input). */
function parse(schema, value, what = 'Input') {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const details = result.error.issues.slice(0, 10).map((i) => ({ field: i.path.join('.') || what, message: i.message }));
  throw E.validation(`${what} tidak valid.`, details);
}

module.exports = { schemas, parse, idParam, nimParam, deviceIdHeader, z };
