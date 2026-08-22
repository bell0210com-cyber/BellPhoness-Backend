import fs from 'fs';
import { fileURLToPath } from 'url';

const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/pkotqxwo/image/upload';
const UPLOAD_PRESET = 'bell_products';
// We'll use a premium Unsplash image URL directly!
const IMAGE_URL = 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=1600&q=85';

async function upload() {
  try {
    const res = await fetch(CLOUDINARY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: IMAGE_URL,
        upload_preset: UPLOAD_PRESET
      })
    });
    
    if (!res.ok) {
      console.error('Failed to upload:', await res.text());
      return;
    }
    
    const data = await res.json();
    console.log('UPLOAD SUCCESSFUL!');
    console.log('SECURE URL:', data.secure_url);
  } catch (err) {
    console.error('Error:', err);
  }
}

upload();
