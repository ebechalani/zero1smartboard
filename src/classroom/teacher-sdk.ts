/**
 * The ONLY module that imports the teacher side of Firebase (docs/CLASSROOM.md §4.2): app, Auth with
 * the Google popup, the full Firestore SDK (live listeners, transactions, aggregation) and App Check.
 * Loaded with `import()` from firebase.ts at dashboard page load, never statically.
 */
export { initializeApp, getApps } from 'firebase/app';
export {
  initializeAuth,
  getAuth,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  reauthenticateWithPopup,
  onAuthStateChanged,
  signOut,
  deleteUser,
  connectAuthEmulator,
} from 'firebase/auth';
export {
  initializeFirestore,
  memoryLocalCache,
  connectFirestoreEmulator,
  doc,
  collection,
  getDoc,
  getDocs,
  getCountFromServer,
  onSnapshot,
  runTransaction,
  writeBatch,
  updateDoc,
  deleteDoc,
  deleteField,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  Timestamp,
  Bytes,
} from 'firebase/firestore';
export { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
