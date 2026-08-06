/**
 * Storage upload helper with client-side validation and progress reporting.
 * Storage Rules re-validate type/size; this layer exists for UX and to keep the
 * path conventions in one place.
 */

import { storage } from '../firebase-config.js';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-storage.js';
import { validateFile, safeFileName } from './sanitize.js';
import {
  uploadsEnabled, inlineFallbackEnabled, FEATURES, UPLOADS_DISABLED_MSG
} from '../features.js';

/**
 * Re-encode an image small enough to live inside a Firestore document.
 * Used when Cloud Storage is unavailable (it requires the Blaze plan) so that
 * avatars and chat images still work on the free tier.
 */
async function toInlineImage(file) {
  const maxBytes = (FEATURES.inlineImageMaxKB || 420) * 1024;

  for (const [size, quality] of [[900, 0.82], [640, 0.74], [420, 0.66]]) {
    const shrunk = await compressImage(file, { maxSize: size, quality });
    if (shrunk.size <= maxBytes) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          url: reader.result,          // data: URL, stored on the document
          path: null,                  // nothing in Storage to clean up later
          name: file.name,
          size: shrunk.size,
          type: shrunk.type,
          inline: true
        });
        reader.onerror = () => reject(new Error('تعذّرت قراءة الصورة.'));
        reader.readAsDataURL(shrunk);
      });
    }
  }
  throw new Error('الصورة كبيرة جداً. اختر صورة أصغر أو فعّل التخزين السحابي.');
}

/** Storage path builders — keep them in sync with storage.rules. */
export const paths = {
  avatar: (uid, file) => `avatars/${uid}/${Date.now()}_${safeFileName(file.name)}`,
  client: (clientId, file) => `clients/${clientId}/${Date.now()}_${safeFileName(file.name)}`,
  task: (taskId, file) => `tasks/${taskId}/${Date.now()}_${safeFileName(file.name)}`,
  request: (uid, file) => `requests/${uid}/${Date.now()}_${safeFileName(file.name)}`,
  chat: (chatId, uid, file) => `chat/${chatId}/${uid}/${Date.now()}_${safeFileName(file.name)}`
};

/**
 * @returns {Promise<{url:string, path:string, name:string, size:number, type:string}>}
 */
export function uploadFile(file, path, {
  maxMB = 10,
  kinds = ['image', 'doc'],
  onProgress = null
} = {}) {
  // Last line of defence: the UI hides upload controls while the flag is off,
  // but any caller that slips through fails here rather than against Storage.
  if (!uploadsEnabled()) return Promise.reject(new Error(UPLOADS_DISABLED_MSG));

  const check = validateFile(file, { maxMB, kinds });
  if (!check.ok) return Promise.reject(new Error(check.error));

  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
    cacheControl: 'private, max-age=3600'
  });

  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      async (err) => {
        // Storage is unavailable without the Blaze plan. Rather than fail an
        // avatar or a chat image outright, keep it inline where that is safe.
        const recoverable = [
          'storage/unauthorized', 'storage/unknown', 'storage/quota-exceeded',
          'storage/project-not-found', 'storage/bucket-not-found', 'storage/retry-limit-exceeded'
        ].includes(err?.code);

        if (recoverable && inlineFallbackEnabled() && file.type?.startsWith('image/')) {
          console.warn(`[luma] Storage unavailable (${err.code}) — storing the image inline.`);
          try { resolve(await toInlineImage(file)); } catch (fallbackErr) { reject(fallbackErr); }
          return;
        }
        reject(err);
      },
      async () => {
        try {
          resolve({
            url: await getDownloadURL(task.snapshot.ref),
            path,
            name: file.name,
            size: file.size,
            type: file.type,
            inline: false
          });
        } catch (err) { reject(err); }
      }
    );
  });
}

export async function deleteFile(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch (err) {
    if (err.code !== 'storage/object-not-found') throw err;
  }
}

/**
 * Downscale an image before upload — keeps avatars small and strips EXIF
 * (including GPS) as a side effect of re-encoding through a canvas.
 */
export function compressImage(file, { maxSize = 900, quality = 0.85 } = {}) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return Promise.resolve(file);
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      if (scale >= 1 && file.size < 400 * 1024) return resolve(file);

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(
          blob ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file
        ),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/** Open a file picker and return the chosen files. */
export function pickFiles({ accept = 'image/*', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files || []));
      input.remove();
    }, { once: true });
    document.body.append(input);
    input.click();
  });
}
