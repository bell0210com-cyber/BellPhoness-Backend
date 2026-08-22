import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';
import crypto from 'crypto';
import { db } from '../src/config/firebaseAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMPORT_DIR = __dirname;
const PHOTOS_DIR = path.join(IMPORT_DIR, 'product-photos');

// Cloudinary config
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/pkotqxwo/image/upload';
const UPLOAD_PRESET = 'bell_products';

// Upload image to Cloudinary (returns secure_url or null)
async function uploadToCloudinary(filePath, fileName, rowIndex) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[Row ${rowIndex}] Warning: Image file not found - ${fileName}`);
    return null;
  }

  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const base64Data = fs.readFileSync(filePath, 'base64');
    const dataUri = `data:${mimeType};base64,${base64Data}`;

    const res = await fetch(CLOUDINARY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: dataUri,
        upload_preset: UPLOAD_PRESET
      })
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`[Row ${rowIndex}] Warning: Cloudinary upload failed - ${errorText}`);
      return null;
    }

    const data = await res.json();
    return data.secure_url;
  } catch (error) {
    console.warn(`[Row ${rowIndex}] Warning: Error uploading image - ${error.message}`);
    return null;
  }
}

// Generate SKU: IPHONE15PROMAX-NATURALTITANIUM-256GB
function generateSku(productName, color, storage) {
  const clean = (str) => (str || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const parts = [clean(productName), clean(color), clean(storage)].filter(Boolean);
  return parts.join('-');
}

async function run() {
  console.log('Starting bulk import...');

  let excelFile = path.join(IMPORT_DIR, 'products.xlsx');
  if (!fs.existsSync(excelFile)) {
    excelFile = path.join(IMPORT_DIR, 'bell_products_template.xlsx');
    if (!fs.existsSync(excelFile)) {
      console.error('Error: Excel file not found. Place products.xlsx in backend/import-data/');
      process.exit(1);
    }
  }

  const workbook = xlsx.readFile(excelFile);
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

  console.log(`Found ${rows.length} rows in Excel file. Grouping by Product Name + Brand...`);

  // Group by Product Name + Brand
  const productGroups = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + 2; // +1 for 0-index, +1 for header

    const productName = (row['Product Name'] || '').toString().trim();
    const brand = (row['Brand'] || '').toString().trim();
    if (!productName || !brand) {
      console.log(`[Row ${rowIndex}] Skipping row due to missing Product Name or Brand.`);
      continue;
    }

    const groupKey = `${productName}|${brand}`;
    if (!productGroups[groupKey]) {
      productGroups[groupKey] = [];
    }
    
    // Attach rowIndex for warning tracking
    productGroups[groupKey].push({ ...row, _rowIndex: rowIndex });
  }

  let productsCreated = 0;
  let variantsProcessed = 0;
  let imageWarnings = 0;

  const firestore = db();

  for (const [groupKey, variantRows] of Object.entries(productGroups)) {
    const firstRow = variantRows[0];
    const productName = firstRow['Product Name'].toString().trim();
    const brand = firstRow['Brand'].toString().trim();
    const category = (firstRow['Category'] || '').toString().trim();
    const description = (firstRow['Short Description'] || '').toString().trim();

    console.log(`Processing Product: ${productName} (${brand}) with ${variantRows.length} variant(s)...`);

    const variants = [];

    for (const row of variantRows) {
      const color = (row['Color'] || '').toString().trim();
      const storage = (row['Storage'] || '').toString().trim();
      let sku = (row['SKU'] || '').toString().trim();
      if (!sku) {
        sku = generateSku(productName, color, storage);
      }

      const regularPrice = Number(row['Regular Price (AED)']) || 0;
      const salePriceValue = row['Sale Price (Optional AED)'];
      const salePrice = salePriceValue ? Number(salePriceValue) : null;
      const stock = Number(row['Stock']) || 0;
      const imageFileName = (row['Image File Name (Matches Google Drive)'] || '').toString().trim();

      const images = [];
      if (imageFileName) {
        const imagePath = path.join(PHOTOS_DIR, imageFileName);
        const url = await uploadToCloudinary(imagePath, imageFileName, row._rowIndex);
        if (url) {
          images.push(url);
        } else {
          imageWarnings++;
        }
      }

      variants.push({
        id: crypto.randomUUID(),
        sku,
        color,
        storage,
        price: regularPrice,
        salePrice,
        stock,
        images
      });
      variantsProcessed++;
    }

    // Create Firestore Document
    const docData = {
      name: productName,
      brand: brand,
      category: category,
      description: description,
      is_active: true,
      featured: false,
      bestseller: false,
      variants: variants,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await firestore.collection('products').add(docData);
    productsCreated++;
  }

  console.log('\n================================');
  console.log('IMPORT COMPLETE');
  console.log('================================');
  console.log(`Products Created: ${productsCreated}`);
  console.log(`Variants Processed: ${variantsProcessed}`);
  console.log(`Image Skips/Warnings: ${imageWarnings}`);
  
  process.exit(0);
}

run().catch((err) => {
  console.error('Fatal Error during import:', err);
  process.exit(1);
});
