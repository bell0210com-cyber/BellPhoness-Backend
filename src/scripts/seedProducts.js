import { db } from '../config/firebaseAdmin.js';

const image = (id, width = 800) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;

const colors = [
  { name: 'Black Titanium', hex: '#252525' },
  { name: 'Natural Titanium', hex: '#8a887e' },
  { name: 'White Titanium', hex: '#dddcd5' },
  { name: 'Blue Titanium', hex: '#5b6a78' },
];

const storages = ['128 GB', '256 GB', '512 GB'];

function buildVariants(skuPrefix, basePrice) {
  const variants = [];
  colors.slice(0, 2).forEach((color, ci) => {
    storages.forEach((storage, si) => {
      const price = basePrice + si * 400;
      variants.push({
        id: `${skuPrefix}-${ci}-${si}`,
        sku: `${skuPrefix}-${color.hex.replace('#', '')}-${storage.replace(' ', '')}`,
        color: color.name,
        colorHex: color.hex,
        storage,
        price,
        salePrice: Math.random() > 0.6 ? Math.round(price * 0.92) : null,
        stock: Math.floor(Math.random() * 20) + 1,
        images: [image('photo-1592750475338-74b7b21085ab'), image('photo-1511707171634-5f897ff02aa')],
      });
    });
  });
  return variants;
}

const iphoneModels = [
  ['iPhone 16 Pro Max', 4899], ['iPhone 16 Pro', 4299], ['iPhone 16', 3399], ['iPhone 16 Plus', 3799],
  ['iPhone 15 Pro Max', 4599], ['iPhone 15 Pro', 3999], ['iPhone 15', 3099], ['iPhone 15 Plus', 3499],
  ['iPhone 14 Pro Max', 4299], ['iPhone 14 Pro', 3699], ['iPhone 14', 2799], ['iPhone 14 Plus', 3199],
  ['iPhone 13 Pro Max', 3999], ['iPhone 13 Pro', 3399], ['iPhone 13', 2499], ['iPhone 13 mini', 2299],
  ['iPhone 12 Pro Max', 3699], ['iPhone 12 Pro', 3099], ['iPhone 12', 2199], ['iPhone 12 mini', 1999],
  ['iPhone 11 Pro Max', 3399], ['iPhone 11 Pro', 2799], ['iPhone 11', 1799],
];

const samsungModels = [
  ['Galaxy S25 Ultra', 5199], ['Galaxy S25+', 4399], ['Galaxy S25', 3699],
  ['Galaxy S24 Ultra', 4699], ['Galaxy S24+', 3999], ['Galaxy S24', 3299],
  ['Galaxy S23 Ultra', 4199], ['Galaxy S23+', 3599], ['Galaxy S23', 2999],
  ['Galaxy Z Fold 6', 7299], ['Galaxy Z Flip 6', 4199],
  ['Galaxy Z Fold 5', 6499], ['Galaxy Z Flip 5', 3699],
  ['Galaxy Note 20 Ultra', 3299],
];

const accessories = [
  ['AirPods Pro (2nd Gen)', 899], ['AirPods Max', 1899], ['Galaxy Buds Pro', 749],
  ['MagSafe Wireless Charger', 249], ['20000mAh Power Bank', 299], ['Silicone Phone Case', 99],
  ['Tempered Glass Screen Protector', 49], ['Fast Car Charger 45W', 129],
  ['USB-C to USB-C Cable', 69], ['Portable Bluetooth Speaker', 449],
];

const electronics = [
  ['iPad Pro 12.9"', 4299], ['iPad Air', 2799], ['Galaxy Tab S9', 2999],
  ['Apple Watch Series 10', 1799], ['Galaxy Watch 7', 1499], ['MacBook Air M3', 5999],
  ['55" Smart 4K TV', 2199], ['Adjustable Laptop Stand', 199],
  ['Wireless Ergonomic Mouse', 149], ['Mechanical Keyboard', 349],
];

function buildAccessoryVariant(sku, name, price) {
  return [
    {
      id: `${sku}-default`,
      sku,
      color: null,
      colorHex: null,
      storage: null,
      price,
      salePrice: Math.random() > 0.7 ? Math.round(price * 0.9) : null,
      stock: Math.floor(Math.random() * 30) + 1,
      images: [image('photo-1505740420928-5e560c06d30e')],
    },
  ];
}

async function seed() {
  const collection = db().collection('products');
  const timestamp = new Date();
  let count = 0;

  for (const [name, price] of iphoneModels) {
    const skuPrefix = 'APL-' + name.replace(/\s+/g, '').slice(0, 10).toUpperCase();
    await collection.add({
      name,
      brand: 'Apple',
      category: 'iPhone',
      description: `${name} — premium performance and camera system from Apple.`,
      warranty: 'Warranty information is confirmed at checkout where applicable.',
      images: [image('photo-1592750475338-74b7b21085ab')],
      variants: buildVariants(skuPrefix, price),
      is_active: true,
      featured: Math.random() > 0.7,
      bestseller: Math.random() > 0.7,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    count++;
  }

  for (const [name, price] of samsungModels) {
    const skuPrefix = 'SMS-' + name.replace(/\s+/g, '').slice(0, 10).toUpperCase();
    await collection.add({
      name,
      brand: 'Samsung',
      category: 'Samsung',
      description: `${name} — flagship Samsung smartphone with advanced display and camera.`,
      warranty: 'Warranty information is confirmed at checkout where applicable.',
      images: [image('photo-1610945265064-0e34e5519bbf')],
      variants: buildVariants(skuPrefix, price),
      is_active: true,
      featured: Math.random() > 0.7,
      bestseller: Math.random() > 0.7,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    count++;
  }

  for (const [name, price] of accessories) {
    const sku = 'ACC-' + name.replace(/\s+/g, '').slice(0, 12).toUpperCase();
    await collection.add({
      name,
      brand: 'BELL Select',
      category: 'Accessories',
      description: `${name} — a practical addition to your everyday technology.`,
      warranty: 'Warranty information is confirmed at checkout where applicable.',
      images: [image('photo-1505740420928-5e560c06d30e')],
      variants: buildAccessoryVariant(sku, name, price),
      is_active: true,
      featured: Math.random() > 0.8,
      bestseller: Math.random() > 0.8,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    count++;
  }

  for (const [name, price] of electronics) {
    const sku = 'ELC-' + name.replace(/\s+/g, '').slice(0, 12).toUpperCase();
    await collection.add({
      name,
      brand: 'BELL Select',
      category: 'Electronics',
      description: `${name} — reliable everyday electronics for work and life.`,
      warranty: 'Warranty information is confirmed at checkout where applicable.',
      images: [image('photo-1544244015-0df4b3ffc6b0')],
      variants: buildAccessoryVariant(sku, name, price),
      is_active: true,
      featured: Math.random() > 0.8,
      bestseller: Math.random() > 0.8,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    count++;
  }

  console.log(`✅ Seeded ${count} products into Firestore.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});