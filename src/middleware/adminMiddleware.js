export function requireAdmin(req, res, next) {
  if (!req.user?.admin) return res.status(403).json({ message: 'Admin authorization required.' });
  return next();
}
