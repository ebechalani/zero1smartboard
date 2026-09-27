/**
 * The ONLY module that imports the student side of Firebase (docs/CLASSROOM.md §4.2): app, Auth,
 * Firestore Lite (REST, about 62 KB gzip) and App Check. Loaded with `import()` from firebase.ts on
 * first use, never statically. Only the functions used are re-exported, so the chunk tree-shakes.
 */
export { initializeApp, getApps } from 'firebase/app';
export {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
  signInAnonymously,
  signOut,
  deleteUser,
} from 'firebase/auth';
export {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  increment,
  Timestamp,
  Bytes,
} from 'firebase/firestore/lite';
export { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
