/**
 * Public web config of the Firebase project behind the class platform (docs/CLASSROOM.md §6.1).
 * Where to find it: Firebase console → Project settings → General → Your apps → the Web app → Config.
 * These values are not secret: they identify the project; firestore.rules control access.
 * While apiKey, authDomain, projectId and appId are empty:
 * - the simulator has no Hand in button and never downloads Firebase;
 * - teacher.html says "not set up yet".
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  /** Accepted so the console snippet can be pasted whole; unused. */
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
}

export const FIREBASE_CONFIG: FirebaseWebConfig = {
  apiKey: 'AIzaSyAnI-aP1P-DFfrzRmONeA_qiYoU--6iEE8',
  authDomain: 'zero1-smartboard.firebaseapp.com',
  projectId: 'zero1-smartboard',
  storageBucket: 'zero1-smartboard.firebasestorage.app',
  messagingSenderId: '344075563068',
  appId: '1:344075563068:web:f0982ec500a490f8765339',
};

/** reCAPTCHA Enterprise site key for App Check (docs/CLASSROOM.md §3.6, step 9). Empty = App Check off. */
export const APP_CHECK_SITE_KEY = '';

/** Deployment defaults the maintainer may tune (docs/CLASSROOM.md §6.2). */
export const CLASSROOM_DEFAULTS = {
  /** Default "Keep hand-ins for" of new classes, in weeks (1-52). */
  keepWeeks: 10,
} as const;
