import multer from 'multer';
const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 }, fileFilter: (req, file, callback) => callback(allowed.has(file.mimetype) ? null : Object.assign(new Error('Only JPG, PNG, and WEBP images are allowed.'), { status: 400 }), allowed.has(file.mimetype)) });
