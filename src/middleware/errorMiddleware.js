export function notFound(req, res) { res.status(404).json({ message: 'Route not found.' }); }
export function errorHandler(error, req, res, next) {
  console.error(error);
  res.status(error.status || 500).json({
    message: error.message || 'Unexpected server error.',
    rejection_reason: error.rejection_reason || error.code || error.details?.rejection_reason_code || null,
    code: error.code || null,
  });
}
