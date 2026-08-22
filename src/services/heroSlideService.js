import { db } from '../config/firebaseAdmin.js';

const heroSlides = () => db().collection('heroSlides');

export function validateHeroSlide(input) {
  if (!input.imageUrl?.trim()) {
    throw Object.assign(new Error('Image URL is required.'), { status: 400 });
  }

  return {
    imageUrl: input.imageUrl.trim(),
    eyebrowText: input.eyebrowText?.trim() || '',
    headingLine1: input.headingLine1?.trim() || '',
    headingLine2: input.headingLine2?.trim() || '',
    description: input.description?.trim() || '',
    primaryButtonText: input.primaryButtonText?.trim() || '',
    primaryButtonLink: input.primaryButtonLink?.trim() || '',
    secondaryButtonText: input.secondaryButtonText?.trim() || '',
    secondaryButtonLink: input.secondaryButtonLink?.trim() || '',
    badgeTextLine1: input.badgeTextLine1?.trim() || '',
    badgeTextLine2: input.badgeTextLine2?.trim() || '',
    order: Number(input.order) || 0,
    isActive: Boolean(input.isActive),
  };
}

export async function listHeroSlides(activeOnly = false) {
  let query = heroSlides().orderBy('order', 'asc');
  
  if (activeOnly) {
    query = query.where('isActive', '==', true);
  }
  
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getHeroSlide(id) {
  const snapshot = await heroSlides().doc(id).get();
  if (!snapshot.exists) {
    throw Object.assign(new Error('Slide not found.'), { status: 404 });
  }
  return { id: snapshot.id, ...snapshot.data() };
}

export async function createHeroSlide(input) {
  const data = validateHeroSlide(input);
  const timestamp = new Date();
  const ref = await heroSlides().add({
    ...data,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return getHeroSlide(ref.id);
}

export async function updateHeroSlide(id, input) {
  const data = validateHeroSlide(input);
  const ref = heroSlides().doc(id);
  
  const doc = await ref.get();
  if (!doc.exists) {
    throw Object.assign(new Error('Slide not found.'), { status: 404 });
  }
  
  await ref.update({
    ...data,
    updatedAt: new Date(),
  });
  
  return getHeroSlide(id);
}

export async function deleteHeroSlide(id) {
  const ref = heroSlides().doc(id);
  const doc = await ref.get();
  if (!doc.exists) {
    throw Object.assign(new Error('Slide not found.'), { status: 404 });
  }
  await ref.delete();
  return { id, deleted: true };
}
