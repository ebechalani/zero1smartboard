# ZERO1 Classes: class platform specification (FINAL)

Status: final specification, 2026-09-26. It replaces the draft that three reviewers
(security, classroom UX, feasibility) examined. Every blocker and major finding is
resolved in the text. The [Decisions log](#11-decisions-log) says how each one was
resolved.

Audience:

- the three developers who build it:
  - **A**: data layer and backend;
  - **B**: student side in the simulator;
  - **C**: teacher dashboard and review page;
- the **maintainer**, who owns the Firebase project.

Words marked **MUST** are the contract between the developers. To change one, edit this
document first.

---

## 0. Overview

### 0.1 What we build

A hand-in platform for the ZERO1 simulator, modelled on Tinkercad Classrooms.

- **Teacher**
  - Signs in with Google on `teacher.html`.
  - Creates a class and gets a 6-character **class code** (`BKT-4M9`) and a **class
    link** (`…/zero1smartboard/#class=BKT4M9`).
  - Types the class list of **usernames** (`ali.k`, `sara.m`, …).
- **Student**
  - Opens the class link, or presses **Hand in** and types the code.
  - **Picks their username** from the list. There is no email and no password: the
    student uses Firebase Anonymous Authentication.
  - Hands in the current sketch (Code mode) or blocks program (Blocks mode, with the
    sketch generated from it), with an optional task, title and note.
- **Dashboard**: the teacher checks the work there.
  - The **Overview** has one row per student: who handed in, what is new, versions.
  - The teacher reads the code and downloads the `.ino` (one file, or a `.zip`).
  - **Open** runs the hand-in in the simulator. It runs inside a **sandboxed review
    page**, so a student's sketch can never touch the teacher's session (§3.4).
- **Backend**: Firebase Authentication and Cloud Firestore on the free **Spark** plan.
  There is no server code: all logic is client code plus Firestore Security Rules.
- **Email relay**: the platform **replaces** it (tools/email-relay, docs/EMAIL.md,
  `EMAIL_RELAY_URL`, "Send to teacher"). Share keeps **Copy link** and **Download .ino**.
- **Not configured**: until `src/firebase-config.ts` is filled in, the simulator has no
  Hand in button and never downloads Firebase. The teacher page says "not set up yet".

### 0.2 Fixed decisions (from the teacher; not re-opened)

- Teachers sign in with Google. Students use anonymous auth.
- Usernames are created by the teacher; students pick theirs from the list.
- One Firebase project, owned by the maintainer, serves many schools.
- Spark plan, no Cloud Functions.
- Each teacher sees only their own classes.
- The email relay is removed.
- Class features stay hidden until the project is configured.

### 0.3 Design decisions

| # | Decision | Why |
|---|---|---|
| D1 | The **class code is the class document id** (`classes/BKT4M9`). | One read to join. There is no list query, so codes can only be found by guessing (§2.2). |
| D2 | A code is 6 symbols from `BCDFGHJKLMNPQRSTVWXZ3479` (24 symbols). Typed `2 5 6 8` are read as `Z S G B`. | 24⁶ ≈ 191 M codes. No vowels, so no accidental words. No look-alikes on a projector (§2.2). |
| D3 | The roster is a map `{ studentId: username }` on the class doc, with stable 8-char studentIds. | One read shows the list. A rename keeps the history. The rules check all names at once. |
| D4 | One **member** doc per device (anonymous uid) per class. The student can only create it. | Binds a uid to a username. The teacher sees and removes computers. |
| D5 | **Sign out = a new anonymous uid.** | A device's history stays private to that identity. No rules are needed for re-binding. |
| D6 | **One document per hand-in**: metadata plus content. The batch has **2 writes**: the hand-in and the member counter tick. | Spark is short of reads and writes, not bandwidth (Feasibility 2). The rules enforce a 10 s cooldown and 300 hand-ins per device. |
| D7 | Content is **gzip bytes** (`CompressionStream`), with a plain-string fallback. Limits: sketch 50,000 B, workspace 100,000 B. | Storage lasts about 3× longer (§6.2). The dashboard inflates with a cap (gzip bombs). |
| D8 | Students read only hand-ins with **their own uid**. The teacher reads the whole class. | A student cannot copy a classmate's work by picking their name. |
| D9 | The teacher runs a hand-in on **`review.html`**. The simulator runs there in an `<iframe sandbox="allow-scripts">` (opaque origin). | A crafted sketch escapes the transpiler (proven). In the sandbox it cannot read the site's storage or the dashboard (verified in Chromium, §3.4). |
| D10 | Two named Firebase apps: `z1-student` and `z1-teacher`. | A teacher session and a student session never replace each other. |
| D11 | The student side uses **Firestore Lite** (REST), loaded with `import()` on first use. | About 62 KB gzip, against about 170 KB for the full SDK. |
| D12 | The teacher side uses the full SDK. **Today** is a live listener; longer periods are one-off paged reads. **Memory cache only.** | Live lesson view at the lowest read cost. No student data is left on shared teacher PCs. |
| D13 | Teacher sign-in: `signInWithPopup` called synchronously in the click. **Session persistence only** (the "Keep me signed in" option is removed). | Safari/iPad block a popup after an `await`. No teacher token sits in shared storage on the github.io origin. |
| D14 | Joining has three controls: **always open**, a **15-minute class window**, and a **15-minute window for one student** ("Let ali.k join again"). All times come from the server. | Lab PCs lose their sign-in every lesson. A leaked code is useless while joining is closed. |
| D15 | Classes have **tasks** (up to 30). A hand-in carries a `taskId`. | "Everyone's Traffic light" becomes one filter. |
| D16 | **Retention**: `keepWeeks` per class (default 10, set by the maintainer). The dashboard prunes older hand-ins when a class is opened, with a warning a week ahead and a `.zip` download. | 1 GiB of storage and the delete quota both need it at the stated load (§6.2). |
| D17 | Deletions are client batches (at most 400 operations, at most 5,000 deletes per run), resumable through `deleting: true`. Deleting a doc that is already gone is allowed. | No Cloud Functions. Retries and two open tabs never fail a batch. |
| D18 | App Check (reCAPTCHA Enterprise) is **wired in v1**, starts in monitoring mode, and is **enforced by the maintainer's decision** (§3.6). | It is free for only 10,000 assessments a month. Past that, requests fail without billing. |
| D19 | No per-student PIN in v1; the data model leaves room for it (§3.7). | Cost and benefit. |

### 0.4 Architecture

```
 simulator (index.html)                    teacher.html                       review.html
 ┌────────────────────────────────┐        ┌────────────────────────────┐     ┌─────────────────────────────┐
 │ header: [Hand in · ali.k] [Share]│       │ src/teacher/* (vanilla DOM) │     │ trusted banner + Download   │
 │ src/ui/handin-dialog.ts         │        │  uses TeacherApi            │ ──► │ <iframe sandbox=allow-scripts│
 │  uses StudentApi (lazy)         │        │  <a href=review.html#review=│  a  │   src=index.html#review>     │
 │ review mode (#review, sandboxed)│◄───────┼──── postMessage payload ────┼─────│  simulator, opaque origin   │
 └──────────────┬─────────────────┘        └──────────────┬─────────────┘     └─────────────────────────────┘
                │ import() on first open                  │ import() at page load
                ▼                                          ▼
     src/classroom/student.ts                   src/classroom/teacher.ts
      └ import('./student-sdk')                  └ import('./teacher-sdk')
        (app, auth, firestore/lite, app-check?)    (app, auth+popup, firestore, app-check?)
                │                                          │
                ▼                                          ▼
      Firebase Auth (anonymous)   Cloud Firestore (europe-west1) + firestore.rules   Firebase Auth (Google popup)
                └──────────────────►  classes/{code}  ◄─────────────────────────────┘
                                        ├─ members/{uid}
                                        └─ handins/{id}
 pure, no Firebase: src/classroom/{model,codec,errors,session-store}.ts, src/share-link.ts,
                    src/ui/sketch-file.ts, src/firebase-config.ts, src/teacher/zip.ts
```

### 0.5 Work split (file ownership) and order

The convention of docs/ARCHITECTURE.md §2 applies:

- Touch only the files you own.
- Code against the interfaces in this document, even before the other side has landed.
- Write fakes in your own tests.

| Dev | Owns (create / edit) |
|---|---|
| **A** data layer and backend | `firestore.rules`, `firestore.indexes.json`, `firebase.json`, `.env.emulator`, `src/firebase-config.ts`, `src/share-link.ts`, `src/classroom/{model,codec,errors,session-store,firebase,student-sdk,teacher-sdk,student,teacher}.ts`, `scripts/check-bundle.mjs`, `tests/classroom-*.test.ts`, `tests/share-link.test.ts`, `tests/bundle-boundary.test.ts`, `tests-emulator/**`, `vitest.emulator.config.ts`, `package.json` (deps and scripts), `tsconfig.json` (include `tests-emulator`), `.github/workflows/{deploy,ci}.yml`, this document, docs/ARCHITECTURE.md new §12 "Classes: data layer" |
| **B** student side and simulator | `src/ui/handin-dialog.ts`, `src/ui/app.ts` (Hand in, `#class=`, review mode, mode-from-link fix, header label, update prompt), `src/ui/share-dialog.ts`, `src/ui/arduino-ide-dialog.ts`, `src/ui/editor.ts` and `src/ui/blocks-panel.ts` (re-exports from `src/share-link.ts`), `src/ui/style.css`, `src/main.ts`, **X1 transpiler hardening** (`src/transpiler/codegen.ts`, `src/runtime/libs/strings.ts`), the email relay removal (§8), `tests/handin-dialog.test.ts`, `tests/app-review-mode.test.ts`, `tests/share-dialog.test.ts`, `tests/app-header.test.ts`, `tests/arduino-ide-dialog.test.ts`, `tests/codegen.test.ts` (X1 cases), `README.md`, docs/ARCHITECTURE.md §8 |
| **C** teacher side | `teacher.html`, `review.html`, `src/teacher/**` (including `teacher.css` and `zip.ts`), `src/review/**`, `vite.config.ts`, `tests/teacher-dashboard.test.ts`, `tests/fakes/fake-teacher-api.ts`, `tests/review-page.test.ts`, `tests/zip.test.ts`, docs/ARCHITECTURE.md new §13 "Teacher dashboard and review page" |

Order of work:

1. A's **first commit** (about half a day) lands:
   - the pure modules: `model.ts`, `codec.ts`, `errors.ts`, `session-store.ts`, `share-link.ts`, `firebase-config.ts`;
   - the exported interfaces of `student.ts` / `teacher.ts` (§4), with `create*Api()`
     stubs that reject with `ClassroomError('unknown', 'not implemented')`.
2. B and C start at once against those interfaces, using fakes.
3. X1 (transpiler hardening) is independent and can land first.
4. The email relay removal (§8) waits until the review-fix pass now editing
   `share-dialog.ts` / `tools/email-relay` has landed.
5. The **rules and indexes are published to the real project before** a client that
   depends on them is merged (§6.1 step 7).

### 0.6 What was verified for this specification

All files are in `scratchpad/classroom-design/final/`; the log is in Appendix B.

- **Rules**: the complete `firestore.rules` of §3.1 against the Firestore emulator
  (firebase-tools 15.31.0, emulator v1.22.0, Java 21, `@firebase/rules-unit-testing`
  5.0.2, `firebase` 12.19.0).
  - **78 rule tests pass** (R1-R8, §7.1). They cover every happy path and the attacks
    from all three reviews.
  - **10 of 10 rule mutations are caught.** Each mutation removes one new protection:
    - the tick bound to a new hand-in;
    - the join-window expiry;
    - the per-student rejoin;
    - the hand-ins switch;
    - the re-file key list;
    - idempotent delete;
    - the encoding types;
    - server-time windows;
    - the task check;
    - the rejoin keys.
- **End to end** with the real SDKs on the auth and firestore emulators:
  - the teacher (full SDK, memory cache, Google credential) creates a class in a
    transaction and opens a 15-minute window;
  - the student (Lite, anonymous, second named app) joins and hands in **gzip bytes**;
  - **a retried batch with the same id is refused, and the member doc proves the first
    one arrived**;
  - the teacher's Today listener receives it and inflates it with a cap; a 5 MB gzip
    bomb is refused;
  - the teacher re-files it to another student;
  - after sign-out, the new uid sees nothing.
- **Sandbox**: the current production build runs unchanged inside
  `<iframe sandbox="allow-scripts">` served with `Access-Control-Allow-Origin: *`, as
  GitHub Pages serves every file:
  - the editor loads the sketch;
  - Run works and Serial prints;
  - the lazy Blocks chunk loads.
- **Security PoC** (Serial.constructor.constructor), run in Chromium:
  - on the same origin (today's `#code=` link) it read a planted `localStorage` secret,
    opened IndexedDB and opened a popup;
  - inside the sandbox, `localStorage`, `parent.localStorage` and `indexedDB` all threw
    `SecurityError`, and `window.open` returned `null`;
  - `frame-src 'self'` blocked the frame's navigation to another site.
- Without the CORS header the sandboxed frame cannot load its scripts. So the Vite dev
  server needs `cors` for the `null` origin (§4.15).

---

## 1. User flows

Words shown to students must be readable by a 12- to 16-year-old, often in their second
language (plain English; ARCHITECTURE §3). All texts in §1.5 are **MUST** strings for
the tests. B and C may polish the wording later; the codes stay.

### 1.1 Not configured (`isClassroomConfigured() === false`)

- **Simulator**
  - No Hand in button: it is absent from the DOM, not hidden.
  - `src/classroom/*` is never imported, and no request goes to a Google host.
  - A `#class=` link shows the toast "Classes are not set up on this site." and is ignored.
  - Share shows Copy link and Download .ino.
- **teacher.html**: one card, with no Firebase download:
  - "The class platform is not set up on this site yet."
  - For the maintainer: "Follow docs/CLASSROOM.md to create the Firebase project and
    paste its web config into src/firebase-config.ts." (link to the file on GitHub)
  - A link back to the simulator.
- **review.html** works: it never uses Firebase.
- Emulator mode (`vite --mode emulator`, §4.16) counts as configured.

### 1.2 Student flows (simulator, Hand in dialog)

**Header.**
- While joined, the button reads **Hand in · ali.k**. Otherwise it reads **Hand in**.
- The name comes from the saved session, read synchronously at start-up. So the next
  student at a lab PC sees the previous student's name on arrival.
- Clicking it builds the work like Share does (`exportSketch()`) and opens the dialog in
  **Loading** ("Connecting to your class…"), which calls `api.restore()`.
- If the blocks are still loading, the app shows the toast "The blocks are still
  loading — try again in a moment" and opens no dialog.

**S0 Class link** `…/#class=BKT4M9`.
- At start-up the app takes the hash and removes it, as with `#code=`. It opens the
  dialog in *join mode* with the code filled in.
- Already joined to **this** class: go to Confirm (S5).
- Joined to **another** class: "This computer is in **7B Robotics** as **ali.k**.
  Switch to **8B Robotics**?" with **Switch** (runs `leave()`, then Pick) and **Cancel**.
- After a successful join, join mode ends with: "You're in **8B Robotics** as **ali.k**.
  Work as usual and press **Hand in** when you're done." and an **OK** button.

**S1 Code view.**
- Heading: "Hand in your work to your teacher".
- Input *Class code*: `autocapitalize="characters"`, placeholder `BKT-4M9`, prefilled
  with `z1.classroom.lastCode`.
- **Next**, or Enter in the field.
- The client checks the code with `normalizeClassCode`. An invalid code shows an inline
  message and makes no request: "A class code has 6 letters and digits, like BKT-4M9."
  plus the detail from `codeProblem()`, for example "Class codes never contain the
  letter A." It ends with "Check it with your teacher."
- A valid code calls `api.findClass(code)`. This signs in anonymously if needed, so the
  first Firebase download happens here.
- Errors: `class_not_found`, `handins_closed`, `offline`, `timeout`, `signup_limit`,
  `auth_disabled`, `storage_blocked`, `quota`, `load_failed`, `app_updated`, `unknown`.

**S2 Pick your name.**
- Heading: "Class **8B Robotics** · Mr. B", then "Pick your own name:".
- A radio list of usernames:
  - sorted;
  - in a scroll box with `max-height: 50vh`;
  - with a filter input above it when there are more than 12 names;
  - Enter on a radio = **This is me**.
- Fine print: "Only pick your own name. Your teacher can see which computer joined as
  which name."
- Below the list: "Can't find your name? **Refresh the list**, or ask your teacher."
  Refresh the list calls `api.refreshClass()` (1 read).
- Buttons: **This is me** (disabled until a name is picked) and **Back**.
- Empty roster: "Your teacher has not added any names yet. Ask them to add you."
- **This is me** first checks `joinStatus(cls, studentId, now)` locally:
  - closed: show the `class_closed` text on this view, with no write;
  - open: `api.join(cls, studentId)` → Ready (or the join-mode end text).
- Errors:
  - `class_closed` (closed meanwhile);
  - `not_on_roster` (the name was removed meanwhile: the list reloads);
  - `renamed` is handled silently (the list reloads and the same studentId stays selected);
  - `handins_closed`, `offline`, `timeout`, `quota`, `permission`, `unknown`.

**S2b Already joined.** `findClass` reports that this device already has a member doc
in the class.
- The Pick view is replaced by: "This computer already joined **8B Robotics** as
  **ali.k**."
- Buttons: **Continue as ali.k** and **Not ali.k? Sign out** (S6).

**S3 Ready view.**
- Heading: "Hand in to **8B Robotics** as **ali.k**", with the link **Not ali.k? Sign
  out**.
- When the device has handed in before (m10): "Last handed in: today 10:42 · Traffic
  light".
- **Task**: a select, shown only when the class has tasks. It offers the tasks plus
  "(no task)", with the class's `currentTaskId` preselected.
- The work line: "Your Arduino sketch, 42 lines" or "Your blocks program and the Arduino
  sketch made from it".
- *Title (optional)* (≤ 80 characters) and *Note for your teacher (optional)* (≤ 500,
  textarea).
- Warnings from `HandinWork`:
  - `unchanged: 'example'`: "This is still the example '{title}'. Hand it in anyway?"
    The button then reads **Hand in anyway** and needs a second click.
  - `unchanged: 'blank'`: "Your sketch is still the empty starting sketch. Hand it in
    anyway?" Also needs a second click.
  - `errorCount > 0`: "Your sketch has {n} errors. Your teacher will see them." This is
    a note only; no second click.
- **Hand in as ali.k** (primary). The label is truncated with an ellipsis; the
  `aria-label` has the full name.
- A status line (`role="status"`).
- Client checks before any request:
  - `empty_sketch`: `code.trim() === ''`;
  - `too_large`: code over 50,000 UTF-8 bytes, or workspace over 100,000;
  - `too_soon`: less than 10 s since the last hand-in from this device;
  - `offline`: `navigator.onLine === false`.
- The dialog keeps one `handinId` (`newHandinId()`) per draft. Retries reuse it (§2.9).
- The button shows "Handing in…" and is disabled: one request at a time.

**S4 Success view.** It replaces the form, so nobody presses Hand in twice.
- "✓ Handed in · Traffic light · Blocks · 10:42. Your teacher can see it now."
- Buttons: **Close**, **My hand-ins**, and **Leaving? Sign out of the class on this
  computer** (S6).
- The next Hand in keeps the title and task, clears the note, and shows "Hand in again
  to send a newer version."
- **Timeout, `offline` after sending, or `unknown`**:
  - The status line reads "Checking whether it arrived…". The API reads the member doc
    (1 read).
  - If `lastHandinId === handinId`, show success.
  - Otherwise: "It did not arrive. **Try again**", which reuses the same id.
- Other errors (after the data layer's diagnosis, §4.7):
  - `too_soon`, `limit_reached`;
  - `not_on_roster`: button **Pick your name again** = S6 with the code prefilled;
  - `device_removed`: button **Join again** = Pick with the same uid;
  - `class_deleted`: button **Different class**;
  - `handins_closed`, `offline`, `timeout`, `quota`, `permission`, `index_missing`,
    `unknown`.
- A rename by the teacher is handled inside `handIn`: one automatic retry with the new
  name, and the heading updates.

**S5 Confirm view** (shared computers).

When it appears, when the dialog opens with a saved session and `restore()` returns
`confirm` because:
- this tab has not confirmed yet (`sessionStorage['z1.classroom.confirmed'] !== uid`), or
- the session was last used more than **20 minutes** ago.

What it shows and does:
- "Hand in to **8B Robotics** (Mr. B) as **ali.k**?"
- Buttons:
  - **Yes, I'm ali.k**: `api.confirm(session)`, then Ready.
  - **No, I'm someone else**: S6 with the code kept.
  - **Different class**: S6 with the code cleared.
- **My hand-ins** stays hidden until the student has confirmed.

`restore()` errors:
- `device_removed`: "Your teacher removed this computer from the class." + **Join again**.
- `not_on_roster`: "Your name is no longer on the class list." + **Pick your name again**.
- `class_deleted`: "This class no longer exists." + **OK** (the session is cleared).
- `handins_closed`: text + **Different class**.
- `lost_identity`: the browser lost its anonymous sign-in (storage wiped, or SDK issue
  #10402). "This computer lost its class sign-in. Pick your name again." The code is
  prefilled.
- `offline`: text + **Try again** (the saved session is kept).

**S6 Sign out** (one action, which replaces the draft's Switch user and Leave).
- Confirm: "Sign out of 8B Robotics on this computer? Your hand-ins stay with your teacher."
- Then `api.leave({ forgetCode })`:
  - the anonymous user is deleted when possible (errors ignored), then signed out;
  - `z1.classroom` and the tab's confirm flag are cleared;
  - `lastCode` is kept unless the student chose **Different class**.
- Then the Code view, with the code prefilled and editable.
- The previous student's history is no longer visible on this computer.

**S7 My hand-ins.**
- Shown only after the student has confirmed.
- A disclosure, **My hand-ins from this computer**, closed by default. Opening it calls
  `api.myHandins(session)`: the newest 20, then **Show more**.
- Each row: date and time, task or title (or "(no title)"), and Code/Blocks.
- **Open** closes the dialog and calls `openWork(content)`. That sets `location.hash`
  to the `#code=` / `#blocks=` link, and the existing `hashchange` handler asks "Load
  the sketch from this link?" when work would be lost. This is the student's own work,
  on their own origin.
- Empty list: "Nothing handed in from this computer yet."
- Students never see other devices' or other students' hand-ins, and cannot edit or
  delete a hand-in.

The dialog footer has **Close** only. The teacher link is gone (m3).
- Esc closes the dialog.
- While the dialog is open, Ctrl+Enter and Esc do not run or stop the sketch (the App's
  keyboard guard).

### 1.3 Teacher flows (teacher.html)

**Layout.**
- Top bar:
  - "ZERO1 Classes";
  - when a class is open, a **class switcher** (select) that replaces the class-list
    column, so the list and detail get the full width at 1366 px (m8);
  - "Open the simulator" (`./`);
  - the teacher's name and email;
  - **Sign out**.
- Without an open class, the page shows the class list.

**Error display.**
- A dismissible banner at the top of the page shows the §1.5 teacher text.
- A listener that fails shows the banner and a **Retry** button that re-subscribes.
- Writes show "Saving…" next to the control until they settle. After 10 s: "Waiting for
  the connection… the change is saved when you are back online."
- Destructive actions are disabled while `navigator.onLine === false`.

**T1 Sign in.**
- Signed-out view:
  - title "ZERO1 Classes";
  - one paragraph: "Create a class, give your students the class code, and see their
    work here.";
  - the button **Sign in with Google**.
- The button reads "Loading…" and is disabled until `api.ready` resolves. The dashboard
  loads the teacher SDK at page load.
- The click handler calls `api.signIn()` as its **first statement**. `signIn` calls
  `signInWithPopup` synchronously (§4.8).
- While the popup is open, the button reads "Signing in…" and is disabled.
- Help lines under the button:
  - "You stay signed in in this tab until you close it or sign out. On a shared
    computer, always sign out."
  - "If Google says your school blocks this app, ask your IT admin to allow it, or use
    another Google account."
- Errors:
  - `popup_closed` is silent: the button is simply re-enabled;
  - `popup_blocked`, `unauthorized_domain`, `auth_disabled`, `offline`,
    `storage_blocked`, `not_ready`, `unknown`.

**T2 Class list.**
- **+ New class**.
- Cards, newest first (sorted client-side by `createdAt`). Each card shows:
  - the class name and the formatted code;
  - "n students";
  - a joining badge ("Joining open", "Joining closed", "Joining open · 12 min"), always
    with text;
  - "Hand-ins stopped" or "Deleting…" when relevant.
- A section **Hand-ins stopped** collects old classes.
- Empty state: "No classes yet. Create your first class."
- Live through `watchClasses`. The last opened class (`z1.teacher.lastClass`) is
  re-opened.

**T3 Create class** (dialog).
- *Class name* (required, 1-60 characters after `cleanLine`).
- *Your name as students see it* (prefilled from the Google display name, 0-60).
- *Student usernames* (textarea; one per line; commas and semicolons also split).
- Checkbox **Shorten last names to an initial** (on by default): "Ali Khalil" becomes
  `ali.k`.
- *Tasks (optional, one per line)*, for example "Traffic light".
- *Students can join*: **Always, until I close it** (default) / **Not yet**.
- A live preview from `planRosterAdd()` shows:
  - the normalised names;
  - the problems per line: invalid, duplicate, too short, too long, more than 100,
    collision after shortening;
  - **near-duplicate warnings** for names that differ by one character, for example
    "ali.k and ali.m differ by one letter; students may pick the wrong one". These
    warnings do not block.
- **Create** is disabled while the name is empty or there are problems. It calls
  `createClass()`, a transaction with code-collision retry.
- The class then opens with a banner: "Class created. Give your students the code
  **BKT-4M9** or the class link."
- Errors: `code_collision`, `offline`, `quota`, `permission`, `unknown`.

**T4 Class page header.**
- The class name.
- The big formatted code, with **Copy code**, **Copy class link** and **Show to the class**.
- The **joining control**:
  - *Always open*: [switch on]. "Anyone with the code can join and pick a name."
  - *Closed*: [switch off] and **Open for 15 minutes**. "Students who already joined can
    still hand in."
  - *Window open*: "Joining open · 12:34 left", with **+15 min** and **Close now**.
    - The countdown uses `joinWindowAt + 15 min`, the server time, against the local
      clock.
    - Tip under it: "On lab computers that forget sign-ins, open joining at the start of
      each lesson."
- The switch **Accepting hand-ins** (on/off). Off: "This class no longer accepts
  hand-ins (use it for last year's classes)."
- **Current task** select ("no task" / the tasks) and **Manage tasks** (Settings).
- Tabs: **Overview** | **All hand-ins** | **Students** | **Settings**.
- Opening the class starts the background retention check (§2.11). Its notices appear
  on the Overview.

**T5 Overview** (default tab, M1).
- **Period** select:
  - **Today** (default, live: `watchTodayHandins`);
  - **Last 7 days**, **Last 14 days**, **Last 30 days**: one-off `loadHandins`, with a
    **Refresh** button.
  - The choice is remembered per class in `z1.teacher.period.<code>`.
- **Task** filter: All / each task (client-side).
- Header line: "22 of 28 handed in today" (or "…in the last 7 days"), counting roster
  students with at least one hand-in in the view.
- One row per roster student, sortable by name (default) or by last hand-in. Keys ↑/↓
  move between rows; Enter opens the detail. Columns:
  - **Status**, always as text plus an icon:
    - "● New": a hand-in newer than the `seen` mark in
      `z1.teacher.seen.<code>` (studentId → createdAt ms);
    - "✓ Seen";
    - "Nothing yet".
  - **Last hand-in**: time ("10:42" today, "Mon 10:42" this week, else the date) · task
    or title.
  - **Versions**: the number in the view.
  - **Computers**:
    - normally neutral text ("1 computer", "2 computers");
    - an amber badge **with text**, "2 computers within an hour", only when two
      different uids handed in for this student within 60 minutes (M14).
  - **Open**: a real link, `<a class="z1-btn" target="_blank" rel="noopener noreferrer"
    href="./review.html#review=…">`, for the latest version. It has `aria-disabled`
    until the content is decoded; decoding happens right after the data arrives.
    Middle-click and Ctrl+click open many tabs.
  - **.ino**: a button, enabled once the content is decoded, with no `await` between the
    click and the download.
- Opening the detail, **Open** or **.ino** marks the student as seen.
- Buttons:
  - **Download latest of each student (.zip)**: from the loaded view, no reads;
  - **Download all shown (.zip)**.
- Live insertions are announced by one polite summary ("2 new hand-ins"). The new-row
  highlight respects `prefers-reduced-motion` and always carries the "New" text.

**T6 Hand-in detail** (panel beside the table at 1200 px or more, else below it).
- The student's versions, newest first.
  - Versions in the view are shown; "3 earlier versions" is collapsed.
  - **Load older versions** calls `studentHandins` (10 per page).
- Each version shows:
  - the time;
  - the task, the title, the note (pre-wrapped text);
  - the computer: `shortDeviceId(uid)`, plus the device label when members are loaded;
  - **Code** / **Blocks**;
  - a read-only `<pre>` code preview (`textContent`). For Blocks, the sketch generated
    from the blocks, labelled so.
- Actions:
  - **Open in the simulator** (a link, as in T5);
  - **Download .ino**: `sketchFileName(username, createdAt)`. For Blocks, the zip
    download also adds `<username>.blocks.json`.
  - **Copy code**: enabled when decoded. Fallback: select the `<pre>` text and say
    "Press Ctrl+C".
  - **Wrong student? Move to…**: a roster select, then `refileHandin(code, id, { studentId })`.
  - **Wrong task? Move to…**: `refileHandin(code, id, { taskId })`.
  - **Remove the computer that sent this**: confirm, then `removeDevice(code, uid)`.
  - **Delete**: confirm "Delete this hand-in? This cannot be undone.", then `deleteHandin()`.
- Content that cannot be decoded shows:
  - `too_large`: "This hand-in is larger than the simulator accepts. It was not made by
    the ZERO1 page." Open, .ino and Copy are disabled.
  - `unsupported`: "Your browser cannot unpack this hand-in. Update your browser."
  - `corrupt`: "This hand-in is damaged."

**T7 All hand-ins.** A feed of the same view, newest first:
- time, username (the current roster name; "(removed) ali.k" when gone), task, title or
  "(no title)", a **Code** / **Blocks** badge, and the first line of the note;
- filters by student and task;
- the same detail panel.

**T8 Students.**
- `watchMembers` runs only while this tab or the Show-to-the-class overlay is visible.
- A table sorted by username: username, computers (neutral count), last joined, and
  actions **Rename**, **Let join again (15 min)** (→ `letRejoin`) and **Remove**.
- **Add students**: the same textarea, checkbox and preview as T3, checked against the
  current roster; **Add** calls `addStudents()`.
- **Rename**: an inline input; `normalizeUsername` + `usernameProblem` + a duplicate
  check, then `renameStudent()`. Help: "Students keep their hand-ins. On their computer
  the new name shows the next time they open Hand in."
- **Remove**:
  - Confirm: "Remove ali.k? Their computers are removed too and they can no longer hand
    in. Their hand-ins stay (shown as '(removed) ali.k')."
  - Then `removeStudent(code, id)`.
- Expanding a row lists its computers:
  - the device label and short id (`Chrome · Windows · 7F3A`), joined at, last hand-in;
  - **Remove this computer**: confirm, then `removeDevice()`.
  - Help: "Remove a computer that joined under the wrong name. The student can join
    again while joining is open, or when you let them join again."
- **Remove computers not used for 30 days**: `removeUnusedDevices(code, 30)`, which
  reports the count removed.
- Members whose studentId is no longer on the roster are listed under "Removed
  students' computers".

**T9 Settings.**
- Rename the class and edit the teacher name (**Save** → `updateClass`).
- **Keep hand-ins for** [1-52] weeks (`keepWeeks`). Help: "Older hand-ins are deleted
  automatically when you open this class. You are warned a week before."
- **Tasks**: add (one per line), rename, delete, set current.
- **Delete class**:
  - Explanation: "Deletes the class, its class list, all hand-ins and all joined
    computers. This cannot be undone."
  - Link: **Download everything first (.zip)**.
  - Input: "Type the class code to confirm". It accepts `BKT4M9` and `bkt-4m9`.
  - **Delete class** calls `deleteClass(code, onProgress)`. Progress reads "Deleting…
    120 of about 340". Then back to T2 with the toast "Class deleted".
  - If the run stops early (budget reached, tab closed, offline, quota), the class stays
    with `deleting: true`. Its card shows "Deletion not finished", and the class page
    shows only **Finish deleting**.

**T10 Show to the class** (full-window overlay).
- The huge formatted code, with `aria-label="B K T 4 M 9"`.
- The class link as short text (`ebechalani.github.io/zero1smartboard/#class=BKT4M9`,
  computed from `location`).
- "Open the link, or press **Hand in**, type the code and pick your name."
- The joining state and "12 of 28 joined", live from members.
- Esc closes it. (A QR code comes later.)

**T11 Sign out.**
- Header **Sign out**, then:
  - unsubscribe every listener;
  - clear the `z1.review.*` handoff entries;
  - `signOut()`;
  - back to T1.

**T12 Delete my data** (bottom of T2), in two steps (Feasibility 5):
1. **Delete all my classes**: type DELETE, then `deleteAllClasses(onProgress)`.
   Resumable; a big account may need more than one day of delete quota, and the text
   says so.
2. When no class is left: **Delete my sign-in record**. Its click handler calls
   `api.deleteAccount()`, which runs `reauthenticateWithPopup` and then `deleteUser`
   immediately.

### 1.4 Review page (review.html)

The teacher lands here from **Open**. The page has two parts.

**Trusted part** (same origin; it never executes student code):
- A top banner, rendered with `textContent`: "**ali.k**'s hand-in · 8B Robotics · Traffic
  light · Mon 10:42 · Blocks".
- The line "The sketch runs in a safe sandbox. Changes here are not saved."
- Buttons **Download .ino** and **Copy code**, both working from the payload.
- `document.title` = "ali.k – ZERO1 review".

**Sandbox**: the rest of the window is:

```html
<iframe sandbox="allow-scripts" src="./index.html#review" title="Simulator running ali.k's hand-in">
```

The page has `<meta http-equiv="Content-Security-Policy" content="frame-src 'self'">`,
so the frame cannot be navigated to another site.

The payload arrives in one of two ways:
- `#review=<base64url JSON>` in the page URL (≤ 60,000 characters; Safari fails around
  80,000);
- `#rid=<16 chars>`, for which the dashboard stored the payload in
  `localStorage['z1.review.<rid>']` when it rendered the link.

The handshake with the frame:
1. The frame posts `{ type: 'z1-review-ready' }` to its parent.
2. The page checks `event.source === iframe.contentWindow` and `event.origin ===
   'null'`, then replies with `{ type: 'z1-review', payload }` (targetOrigin `'*'`;
   the payload is the student's own code, not a secret).
3. The simulator in review mode accepts the message only when `event.source ===
   window.parent` and `event.origin === new URL(location.href).origin`.

- **Nothing runs automatically.** The teacher presses **Run** inside the frame.
- Errors:
  - a bad or missing payload: "This review link is broken. Open the hand-in again from
    the dashboard.";
  - a handoff entry that is gone: "This review link has expired. Open the hand-in again
    from the dashboard."

### 1.5 Error catalogue (`ClassroomErrorCode`)

Placeholders: `{code}` (formatted class code), `{class}` (class name), `{host}`
(`location.host`), `{message}` (error message), and `{reset}`. `{reset}` is the next
quota reset (midnight America/Los_Angeles) in the viewer's local time, from
`quotaResetText(now)`, for example "10:00".

| code | when | student text | teacher text |
|---|---|---|---|
| `not_configured` | config empty | (button absent) | The class platform is not set up on this site yet. |
| `load_failed` | `import()` of a Firebase chunk failed (not after a deploy) | Could not load the class features. Check your internet connection and try again. | Could not load the dashboard. Check your internet connection and reload the page. |
| `app_updated` | `vite:preloadError`, or a hashed chunk returns 404 | The simulator was updated. Reload the page to continue (your work is saved). | The dashboard was updated. Reload the page. |
| `offline` | `navigator.onLine === false`, Firestore `unavailable`, `auth/network-request-failed` | You seem to be offline. Check your internet connection and try again. | You are offline. Check the connection; changes are saved when you are back online. |
| `timeout` | no answer in 20 s (`withTimeout`), `deadline-exceeded` | The class did not answer in time. Try again. | The server did not answer in time. Try again. |
| `quota` | Firestore `resource-exhausted` | The class platform has reached today's free limit. It works again after {reset}. Meanwhile use Share → Download .ino. | The class platform reached its free daily limit. It works again after {reset} (your time). |
| `signup_limit` | `auth/too-many-requests` on anonymous sign-in | Too many new sign-ins on your school network right now. Try again in a few minutes, or use Share → Download .ino. | - |
| `auth_disabled` | `auth/operation-not-allowed`, `auth/admin-restricted-operation` | Joining classes is switched off on this simulator. Tell your teacher. | Google sign-in is not switched on in the Firebase project (see docs/CLASSROOM.md step 3). |
| `storage_blocked` | `auth/web-storage-unsupported` | Your browser blocks the storage this page needs (private window?). Use a normal window. | Your browser blocks the storage sign-in needs (private window?). Use a normal window. |
| `popup_blocked` | `auth/popup-blocked` | - | Your browser blocked the Google sign-in window. Allow pop-ups for this site and click Sign in again. |
| `popup_closed` | `auth/popup-closed-by-user`, `auth/cancelled-popup-request`, `auth/user-cancelled` | - | (no message) |
| `unauthorized_domain` | `auth/unauthorized-domain` | Joining classes is not set up for this web address. Tell your teacher. | This web address is not allowed to sign in yet: add {host} in Firebase → Authentication → Settings → Authorized domains. |
| `recent_login` | `auth/requires-recent-login` | - | Please sign in again to confirm. |
| `not_ready` | `signIn()` / `deleteAccount()` before `ready` | - | Still loading. Try again in a moment. |
| `index_missing` | `failed-precondition` on an indexed query | The class platform is not fully set up yet. Tell your teacher. | The database is missing an index. The site maintainer must deploy firestore.indexes.json (docs/CLASSROOM.md, step 7). |
| `bad_code` | `normalizeClassCode` returned null | A class code has 6 letters and digits, like BKT-4M9. Check it with your teacher. | - |
| `class_not_found` | class doc missing, or `deleting` | There is no class with the code {code}. Check the code with your teacher. | This class no longer exists. |
| `class_closed` | joining not open for this student | Joining {class} is closed right now. Ask your teacher to open joining for a few minutes. | - |
| `handins_closed` | `handinsOpen === false` | {class} no longer accepts hand-ins. If you have a new class code, choose Different class. | - |
| `class_deleted` | class doc missing / `deleting` after joining | This class no longer exists. | - |
| `lost_identity` | saved session, but the anonymous user is gone | This computer lost its class sign-in. Pick your name again. | - |
| `not_on_roster` | studentId no longer on the roster | Your name is no longer on the class list. Pick your name again. | - |
| `device_removed` | own member doc missing | Your teacher removed this computer from the class. Join again. | - |
| `too_soon` | less than 10 s since the last hand-in | Wait a few seconds before handing in again. | - |
| `limit_reached` | member `handinCount >= 300` | This computer has handed in 300 times in this class. Ask your teacher to let you join again, then sign out and join again. | - |
| `empty_sketch` | nothing to hand in | Your sketch is empty. There is nothing to hand in yet. | - |
| `too_large` | size limits | Your work is too big to hand in (more than 50,000 characters of code). Use Share → Download .ino instead. | - |
| `code_collision` | 5 codes taken in a row | - | Could not find a free class code. Try again. |
| `bad_roster` | invalid names reached the API | - | Some usernames are not valid. Fix the list and try again. |
| `classes_left` | `deleteAccount()` while classes remain | - | Delete all your classes first (step 1). |
| `permission` | `permission-denied` without a better diagnosis | The class did not accept this. Try again; if it keeps failing, tell your teacher. | You do not have access to this class. Sign in with the account that created it. |
| `unknown` | anything else | Something went wrong. Try again. | Something went wrong: {message}. Try again. |

`renamed` is internal to the data layer and never shown.

---

## 2. Data model (Cloud Firestore, database `(default)`)

### 2.1 Tree

```
classes/{code}                  code = doc id, e.g. "BKT4M9"
  ├─ members/{uid}              uid = anonymous Firebase uid of a device
  └─ handins/{handinId}         handinId = 20 × [A-Za-z0-9] (made by the client before the batch)
```

There are no other collections and no `teachers` or `users` collection. The teacher's
display name lives on each class; the Google profile stays in Firebase Auth. The draft's
`handinCode` collection is gone: the rules deny it (R8.2).

### 2.2 Class code

- **Alphabet** `BCDFGHJKLMNPQRSTVWXZ3479`: 20 consonants without Y, plus the digits 3, 4,
  7 and 9, so 24 symbols.
  - No vowels, so no accidental words.
  - None of `0 1 2 5 6 8`, which look like O, I/L, Z, S, G and B.
  - Length 6 gives 24⁶ = 191,102,976 codes.
- **Storage and display**: stored and used as the doc id without a separator (`BKT4M9`);
  displayed as `BKT-4M9`.
- **`normalizeClassCode(input)`**:
  1. trim; remove whitespace, `-`, `.` and `_`; uppercase;
  2. map `2→Z`, `5→S`, `6→G`, `8→B`;
  3. match `^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$`, else return null.
- **`codeProblem(input)`** names the first bad character for the inline message. Vowels
  and `0`/`1`: "Class codes never contain the letter A" or "…the digit 0".
- **Generation**: `crypto.getRandomValues` with rejection sampling. Accept bytes below
  240 (10 × 24) and take `% 24`, so there is no modulo bias.
- **Collisions, without a server**: `createClass` runs a Firestore transaction:
  1. `tx.get(classes/CODE)`;
  2. if the doc exists, retry with a new code (at most 5 attempts, then `code_collision`);
  3. otherwise `tx.set(...)`.

  The rules also refuse a create over an existing doc (R1.7).
- **Guessing**: students cannot list `classes`, so codes can only be guessed. Each guess
  is one billed read. With 2,000 classes a random guess hits with probability about
  1e-5. The guesser mostly burns the shared read quota; §3.5 covers that.
- **No code rotation in v1** (decision log, Security 2a). Instead, joining can be closed
  and opened in windows (§2.6), which makes a leaked code useless. v1.1: "Copy class
  with a new code".

### 2.3 `classes/{code}`

| field | type | rule / limit | notes |
|---|---|---|---|
| `schema` | int | `== 1` at create, immutable | for future migrations |
| `ownerUid` | string | `== request.auth.uid` at create, immutable | the teacher's Google uid. Visible to code-holders (§3.5) |
| `name` | string | 1-60 chars | "8B Robotics" |
| `teacherName` | string | 0-60 chars | shown to students |
| `roster` | map<string,string> | §2.4 | studentId → username |
| `joinOpen` | bool | | "always open" |
| `joinWindowAt` | timestamp or null | null or `== request.time` when set | a 15-minute class join window starts here |
| `rejoin` | map<string,timestamp> | ≤ 100 entries, keys ⊆ roster keys, `{}` at create | a 15-minute window for one student starts at `rejoin[studentId]` |
| `handinsOpen` | bool | | false = no hand-ins and no joins ("Hand-ins stopped") |
| `tasks` | map<string,string> | ≤ 30; id `[a-z0-9]{6}`; title 1-60 chars, one line | §2.5 |
| `currentTaskId` | string | `''` or a key of `tasks` | preselected on the student's Ready view |
| `keepWeeks` | int | 1-52 | retention (§2.11); default `CLASSROOM_DEFAULTS.keepWeeks` |
| `deleting` | bool | `false` at create | set first when deleting (§2.11) |
| `createdAt` | timestamp | `== request.time` at create, immutable | `serverTimestamp()` |
| `updatedAt` | timestamp | `== request.time` on every write | `serverTimestamp()` |

Exactly these keys exist at create. An update may change every key except `schema`,
`ownerUid` and `createdAt`, and MUST set `updatedAt`. Size: at most about 8 KB.

### 2.4 Roster and usernames

- `roster` is a map `{ [studentId]: username }` with at most **100** entries.
- **`studentId`**:
  - 8 chars `[a-z0-9]`, random (`newStudentId()`);
  - unique within the class, never reused, never shown;
  - stable across renames; hand-ins and members refer to it.
- **`username`**:
  - `^[a-z0-9][a-z0-9._-]{1,23}$`: 2-24 characters from lowercase ASCII letters,
    digits, `.`, `_` and `-`, starting with a letter or digit;
  - unique in the class.
- **`normalizeUsername(input, { shortenLastName })`**:
  1. NFD, then strip combining marks (`Élise` → `elise`);
  2. lowercase;
  3. with `shortenLastName` (the default in the UI): the first word plus `.` plus the
     first letter of the last word ("Ali Khalil" → `ali.k`, "Ali Ben Salah" → `ali.s`);
  4. whitespace runs → `.`;
  5. drop characters outside the alphabet;
  6. collapse repeated `.`, `_` and `-`;
  7. trim leading and trailing separators;
  8. cut to 24.

  The result is then checked with `usernameProblem()`.
- `nearDuplicates(names)` returns pairs at Levenshtein distance 1, for the warnings.
- The rules validate the whole map at once:
  - `roster.keys().join(' ')` and `roster.values().join(' ')` are each matched with one
    regex;
  - `roster.values().toSet().size() == roster.size()` enforces uniqueness.
  - Note: `join()` **turns non-strings into text**, so an int username `12` passes the
    class rules (R2.6). Only the owner writes rosters, and nobody can join as such an
    entry, because `member.username` must be a string equal to it. Clients MUST still
    read roster and task values with `String(v)`.
- Edits use **field-path updates**, never read-modify-write:
  - add or rename: `{ ['roster.' + id]: name, updatedAt }`;
  - remove: `{ ['roster.' + id]: deleteField(), ['rejoin.' + id]: deleteField(), updatedAt }`.
    The rules require rejoin keys to be roster keys (R3.7).
- A duplicate name is refused by the rules (R3.9).
- Restoring a removed student under the same studentId is deferred to v1.1. Meanwhile:
  re-add the student and use **Move to…** for old hand-ins.

### 2.5 Tasks

- `tasks` is a map `{ [taskId]: title }` with at most **30** entries.
  - `taskId`: 6 chars `[a-z0-9]` (`newTaskId()`).
  - The title comes from `cleanLine`, is 1-60 characters, and has no newline.
- Deleting a task MUST also set `currentTaskId: ''` when it pointed at that task (R3.8).
- A hand-in's `taskId` is `''` or an existing key at submit time. Hand-ins of a deleted
  task keep their id; the dashboard shows "(deleted task)".
- Filtering by task is client-side on the loaded view, so no index is needed.

### 2.6 Joining

A student may create a member doc when all of these hold:
- `deleting == false` and `handinsOpen == true`;
- **and one of**:
  - `joinOpen == true`;
  - `request.time < joinWindowAt + 15 min`;
  - `request.time < rejoin[studentId] + 15 min`.

All times are `serverTimestamp()` values, which the rules check. The teacher's clock
cannot open joining for days.

| teacher action | write |
|---|---|
| Always open / close | `{ joinOpen: true / false, joinWindowAt: null, updatedAt }` |
| Open for 15 minutes / +15 min | `{ joinWindowAt: serverTimestamp(), updatedAt }` (the window restarts) |
| Let ali.k join again (15 min) | `{ ['rejoin.' + id]: serverTimestamp(), updatedAt }` |

The client helper `joinStatus(cls, studentId, nowMs)` evaluates the same condition with
a tolerance of ±60 s for clock skew. The student side uses it to avoid denied writes,
which cost a billed read; the dashboard uses it for the countdown.

### 2.7 `classes/{code}/members/{uid}` (device ↔ username binding)

| field | type | at create (join) | later |
|---|---|---|---|
| `studentId` | string | must be a key of `roster` | immutable |
| `username` | string | must equal `roster[studentId]` | immutable snapshot (display only) |
| `ownerUid` | string | must equal the class `ownerUid` | immutable (lets the teacher read and delete without a `get`) |
| `joinedAt` | timestamp | `== request.time` | immutable |
| `device` | string | ≤ 40 chars, from `deviceLabel(navigator.userAgent)` | immutable. **Untrusted free text** |
| `handinCount` | int | `0` | `+1` per hand-in, ≤ 300 |
| `lastHandinAt` | timestamp or null | `null` | `request.time` of the last hand-in |
| `lastHandinId` | string | `''` | id of the last hand-in |

- **Who writes it**:
  - Only the student creates it, with doc id = own uid, while joining is allowed (§2.6).
  - An existing member doc can never be overwritten. The only student update is the
    counter tick (§2.9).
  - The teacher lists, reads and deletes members. Students cannot delete theirs: it
    carries the cooldown and the counter.
- **The 300 cap is best effort per identity.**
  - Two concurrent batches at 299 can both land, giving 301.
  - Signing out and joining again starts a new count.
  - It bounds a single identity, not an attacker (§3.5).
- **Accumulation**: sign-out and re-joins create new uids and member docs. Anonymous
  Auth records accumulate on Spark with no clean-up. They hold no personal data, and the
  cap is 100 million. "Remove computers not used for 30 days" keeps the member list
  short.

### 2.8 `classes/{code}/handins/{handinId}`

| field | type | rule |
|---|---|---|
| `uid` | string | `== request.auth.uid` |
| `studentId` | string | `== members/{uid}.studentId` (after the batch) |
| `username` | string | `== roster[studentId]` **at submit time** (snapshot) |
| `ownerUid` | string | `== class.ownerUid` |
| `kind` | string | `'code'` or `'blocks'` |
| `taskId` | string | `''` or a key of `class.tasks` |
| `title` | string | ≤ 80 chars (client: `cleanLine`) |
| `note` | string | ≤ 500 chars (client: `cleanMultiline`) |
| `createdAt` | timestamp | `== request.time`, immutable |
| `enc` | string | `'plain'` or `'gzip'` |
| `code` | string or bytes | the Arduino sketch (Blocks: generated from the blocks). `plain`: string ≤ 50,000 UTF-8 bytes. `gzip`: bytes ≤ 50,000. Never empty |
| `workspace` | string or bytes | Blocks: `JSON.stringify(Blockly.serialization.workspaces.save(ws))`, never empty. Code: empty. `plain`: ≤ 100,000 UTF-8 bytes. `gzip`: ≤ 100,000 bytes |

- **Encoding** (`src/classroom/codec.ts`):
  - `encodeContent` gzips both fields with `CompressionStream('gzip')` when it exists
    **and** the gzip total is smaller; otherwise it stores plain strings. A 96-byte
    sketch gzips to 99 bytes, and an average example to about 45 %.
  - The client checks the **raw** sizes (50,000 / 100,000 UTF-8 bytes) before encoding,
    so students see the same limit with or without compression.
- **Decoding** (`decodeContent`) inflates with `DecompressionStream`, **capped** at 2×
  the raw limits (code 100,000 B, workspace 200,000 B). Past that it reports
  `too_large`. A 5 MB gzip bomb fits in under 50 KB; the cap refuses it (e2e).
- The workspace is a string, not a Firestore map:
  - Firestore limits nesting to 20 levels, and Blockly's `next` chains nest one level
    per block;
  - a string is also opaque to indexing.
- A typical hand-in is 1-3 KB stored (§6.2).
- **Updates and deletes**:
  - Students can never update or delete a hand-in.
  - The owner may re-file one: change only `studentId` + `username` (which must match the
    roster) and/or `taskId`.
  - The owner deletes.

### 2.9 The hand-in batch and idempotent retry (MUST)

The id is made **before** the batch with `newHandinId()` (20 × `[A-Za-z0-9]`, crypto
random), and the dialog keeps it for retries of the same draft.

```ts
const batch = writeBatch(db);
batch.set(doc(db, `classes/${code}/handins/${id}`), {
  uid, studentId, username, ownerUid, kind, taskId, title, note,
  createdAt: serverTimestamp(), enc, code, workspace,            // code/workspace: Bytes.fromUint8Array(...) when enc === 'gzip'
});
batch.update(doc(db, `classes/${code}/members/${uid}`), {
  handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: id,
});
await withTimeout(batch.commit());
```

How the rules tie the two writes together:
- The hand-in requires the member doc *after* the batch to have `lastHandinId == id` and
  `lastHandinAt == request.time`.
- The tick requires `handins/{id}` *after* the batch to have this uid and `createdAt ==
  request.time`. So the tick cannot point at an older hand-in (R4.9).
- The tick also requires:
  - `handinCount` to grow by exactly 1 (`increment(1)` works without reading first);
  - at most 300;
  - at least 10 s since `lastHandinAt`.

**Retry protocol.** It covers commits that time out on school Wi-Fi but still land
(M8, F12). On `timeout`, `offline`, `unknown` or `permission-denied`:
1. Read `members/{uid}` (1 read).
2. If `lastHandinId === id`, the hand-in **arrived**: resolve with success.
3. Otherwise run the diagnosis (§4.7). "Try again" reuses the same id.

A duplicate is impossible: a second commit with the same id is an update of an existing
hand-in, which the rules refuse (R6.16, e2e).

### 2.10 Operations and write shapes

| operation | who | requests | reads (incl. rules) | writes / deletes |
|---|---|---|---|---|
| create class | teacher | transaction get + set | 1 | 1 |
| rename class / joining / hand-ins switch / keepWeeks / current task | teacher | `updateDoc` | 0 | 1 |
| add / rename students, tasks | teacher | one `updateDoc` with field paths | 0 | 1 |
| remove student | teacher | `updateDoc` (roster + rejoin) → `members where studentId == id` → batch delete | 1 + n | 1 + n deletes |
| let a student join again / open a window | teacher | `updateDoc` | 0 | 1 |
| remove computer | teacher | `deleteDoc(members/uid)` | 0 | 1 delete |
| find class | student | `getDoc(class)` + `getDoc(members/me)` | 2 | 0 |
| join | student | `setDoc(members/me)` | 1 (rule get) | 1 |
| restore (dialog open) | student | `getDoc(class)` | 1 | 0 |
| hand in | student | 1 batch (§2.9) | ≤ 3 (rules: class, member-after, hand-in-after) | 2 |
| check after timeout / diagnosis | student | `getDoc(members/me)` (+ `getDoc(class)`) | 1-2 | 0 |
| my hand-ins | student | `where uid == me orderBy createdAt desc limit 20` | ≤ 20 (min 1) | 0 |
| re-file hand-in | teacher | `updateDoc` | 1 (rule get) | 1 |
| delete hand-in | teacher | `deleteDoc` | 0 | 1 delete |
| prune | teacher | count + `where createdAt < cutoff orderBy createdAt limit 200` → batch | 1 + n | n deletes |
| delete class | teacher | §2.11 | n | n deletes |

### 2.11 Retention and deletion (no Cloud Functions)

**Retention (D16).** When a class page opens, at most once per class per browser session
(`sessionStorage['z1.teacher.pruned.<code>']`), the dashboard runs in the background:

1. `cutoff = now − keepWeeks × 7 days`.
2. `countHandinsBefore(code, cutoff + 7 days)` (1 read). If the count is above 0, the
   Overview shows: "{n} hand-ins are older than {keepWeeks − 1} weeks and will be
   deleted within a week. **Download them (.zip)** · Change in Settings."
3. `pruneHandins(code, cutoff, 500)`: pages of `where createdAt < cutoff orderBy
   createdAt limit 200`, deleted in batches, at most 500 per opening. If anything was
   deleted, a toast says "Deleted {n} hand-ins older than {keepWeeks} weeks."

`keepWeeks` defaults to `CLASSROOM_DEFAULTS.keepWeeks` (10). The maintainer raises it
for small deployments (§6.2). Classes whose teacher never comes back are not pruned; the
maintainer's yearly review covers them (§6.3).

**Delete class**, `deleteClass(code, onProgress, budget = 5000)`:
1. Unsubscribe this class's listeners.
2. `updateDoc(class, { deleting: true, joinOpen: false, joinWindowAt: null, updatedAt })`.
   From then on no join and no hand-in succeeds.
3. Loop: `getDocs(query(members, limit(400)))`, then one delete batch, until the query
   is empty.
4. Loop: `getDocs(query(handins, limit(400)))`, then one delete batch, until the query
   is empty.
5. `deleteDoc(class)` **last**.

Rules for the loop:
- Every batch has at most 400 operations.
- The owner's deletes use the copied `ownerUid`, so the rules make no document reads.
- Deleting a document that is already gone is allowed, so retries and two open tabs
  never fail (R3.11, R5.3, R7.7).
- The run stops when `budget` deletes are done and returns `'more'`; the UI then shows
  **Finish deleting**.
- Cost: 1 read and 1 delete per document.

`deleteAllClasses(onProgress)` runs `deleteClass` over every class with one shared
budget of 5,000 per run.

### 2.12 Queries and indexes

| who | query | index |
|---|---|---|
| teacher | `classes where ownerUid == uid` (live) | automatic single-field |
| teacher | `classes/{c}` doc (live) | - |
| teacher | `members orderBy joinedAt desc limit 150` (live while visible) | automatic single-field |
| teacher | `members where studentId == id` (remove student) | automatic single-field |
| teacher | `handins where createdAt >= startOfToday orderBy createdAt desc limit 300` (live) | automatic single-field (`createdAt`) |
| teacher | `handins where createdAt >= since orderBy createdAt desc limit 100` (+ `startAfter`) | automatic single-field |
| teacher | `handins where studentId == id orderBy createdAt desc limit 10` | **composite** (studentId ↑, createdAt ↓) |
| teacher | `handins where createdAt < cutoff orderBy createdAt limit 200`, and `count()` | automatic single-field |
| student | `handins where uid == me orderBy createdAt desc limit 20` | **composite** (uid ↑, createdAt ↓) |

`firestore.indexes.json` (MUST, deployed with the rules):

```json
{
  "indexes": [
    { "collectionGroup": "handins", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "uid", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] },
    { "collectionGroup": "handins", "queryScope": "COLLECTION",
      "fields": [{ "fieldPath": "studentId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] }
  ],
  "fieldOverrides": [
    { "collectionGroup": "handins", "fieldPath": "uid", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "studentId", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "username", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "ownerUid", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "kind", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "taskId", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "title", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "note", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "enc", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "code", "indexes": [] },
    { "collectionGroup": "handins", "fieldPath": "workspace", "indexes": [] },
    { "collectionGroup": "members", "fieldPath": "username", "indexes": [] },
    { "collectionGroup": "members", "fieldPath": "ownerUid", "indexes": [] },
    { "collectionGroup": "members", "fieldPath": "device", "indexes": [] },
    { "collectionGroup": "members", "fieldPath": "handinCount", "indexes": [] },
    { "collectionGroup": "members", "fieldPath": "lastHandinId", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "name", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "teacherName", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "roster", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "rejoin", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "tasks", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "currentTaskId", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "joinWindowAt", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "keepWeeks", "indexes": [] },
    { "collectionGroup": "classes", "fieldPath": "schema", "indexes": [] }
  ]
}
```

- The field overrides turn off single-field indexing for every field that is never
  queried on its own. That includes `uid` and `studentId` on hand-ins: the composite
  indexes cover their queries.
- This saves about half of each hand-in's stored size, since index entries count
  toward the 1 GiB (§6.2).
- **The emulator does not check composite indexes.** Tests pass without them.
  Therefore:
  - there is **no silent fallback**: `failed-precondition` on the two composite queries
    becomes `index_missing`, and the data layer logs `console.error` with the index link
    once;
  - step 7 of §6.1 is mandatory;
  - step 11 (the production smoke test) runs both composite queries.
- **Rules are not filters.** Every query MUST carry the constraint the rule checks:
  `ownerUid == uid` for classes, `uid == me` for a student's hand-ins.
  Collection-group queries are denied.

### 2.13 Browser storage

| key | where | owner | content |
|---|---|---|---|
| `z1.classroom` | localStorage | session-store | `{"v":1,"code","className","teacherName","studentId","username","uid","lastUsedAt","lastHandinAt","lastHandinTitle"}` |
| `z1.classroom.lastCode` | localStorage | session-store | the last class code (prefill after Sign out) |
| `z1.classroom.confirmed` | sessionStorage | session-store | the uid confirmed in this tab (S5) |
| `z1.teacher.lastClass` | localStorage | dashboard | last opened class code |
| `z1.teacher.period.<code>` | localStorage | dashboard | `today` / `7` / `14` / `30` |
| `z1.teacher.seen.<code>` | localStorage | dashboard | `{ studentId: createdAtMs }` |
| `z1.teacher.pruned.<code>` | sessionStorage | dashboard | retention already checked in this tab |
| `z1.review.<rid>` | localStorage | dashboard → review page | large review payloads (§1.4). Cleared on sign-out and `pagehide`; the review page drops entries older than 1 day |
| IndexedDB `firebaseLocalStorageDb` | | Firebase Auth | anonymous student session (app `z1-student`) **only**. The teacher session is in the tab's sessionStorage |
| removed | | B | `z1.teacherEmail`, `z1.studentName` (legacy relay keys, deleted once at start-up) |

Every access is wrapped in try/catch, as in the rest of the app. The simulator in the
sandboxed review frame has **no** storage: every accessor throws `SecurityError` there,
and the app must keep working (it does, verified).

---

## 3. Security

### 3.1 `firestore.rules` (MUST; tested as-is, §7.1 and App. B)

A byte-identical copy of the tested file is
`scratchpad/classroom-design/firestore.rules`. Dev A copies it to the repository root.

```
rules_version = '2';

// ZERO1 Classes: Firestore Security Rules (docs/CLASSROOM.md §3).
//
// There is no server: these rules are the only thing standing between the
// public web page and the data. Every write is checked field by field.
//
//   classes/{code}                 a class; the doc id IS the class code
//   classes/{code}/members/{uid}   a device (anonymous uid) that joined as a roster username
//   classes/{code}/handins/{id}    one hand-in: metadata + the sketch (+ blocks), never edited by students
//
// Limits here must match src/classroom/model.ts (tests/classroom-model.test.ts checks it).
// Order inside every condition: checks on the request alone first, document reads (get /
// getAfter, each billed as one read even when the request is denied) last.

service cloud.firestore {
  match /databases/{database}/documents {

    // ------------------------------------------------------------ helpers

    function signedIn() {
      return request.auth != null;
    }

    // Teachers sign in with Google. Anonymous (student) accounts are never teachers.
    // To restrict teachers to some schools later, add e.g.
    //   && request.auth.token.email.matches('.*@(school-a[.]edu|school-b[.]org)$')
    function isTeacher() {
      return signedIn()
        && request.auth.token.firebase.sign_in_provider == 'google.com'
        && request.auth.token.email_verified == true;
    }

    function classPath(code) {
      return /databases/$(database)/documents/classes/$(code);
    }

    function subPath(code, sub, id) {
      return /databases/$(database)/documents/classes/$(code)/$(sub)/$(id);
    }

    function classDoc(code) {
      return get(classPath(code)).data;
    }

    // One document read: only where no copied ownerUid exists (list queries, re-filing).
    function ownsClass(code) {
      return isTeacher() && classDoc(code).ownerUid == request.auth.uid;
    }

    // No document read: the ownerUid copied into members / hand-ins when they were created.
    function ownsExisting() {
      return isTeacher() && resource.data.ownerUid == request.auth.uid;
    }

    // Deleting a document that is already gone changes nothing; allowing it keeps retried or
    // concurrent delete batches (two tabs, a commit that timed out but went through) from failing.
    function canDelete() {
      return resource == null ? isTeacher() : ownsExisting();
    }

    function exactKeys(data, keys) {
      return data.keys().hasOnly(keys) && data.keys().hasAll(keys);
    }

    function textUpTo(value, max) {
      return value is string && value.size() <= max;
    }

    // Class code: 6 symbols, no vowels (no accidental words), none of 0 1 2 5 6 8 O I
    // (look-alikes of letters on a projector).
    function validCode(code) {
      return code.matches('^[BCDFGHJKLMNPQRSTVWXZ3479]{6}$');
    }

    // Firestore auto ids.
    function validAutoId(id) {
      return id is string && id.matches('^[A-Za-z0-9]{20}$');
    }

    // roster: { studentId: username }, at most 100 entries, usernames unique.
    // studentId: 8 x [a-z0-9]; username: 2-24 x [a-z0-9._-], starting with a letter or digit.
    // Rules have no loops: the keys and the values are joined into one string and matched at once.
    function validRoster(roster) {
      return roster is map
        && roster.size() <= 100
        && (roster.size() == 0
          || (roster.keys().join(' ').matches('^[a-z0-9]{8}( [a-z0-9]{8})*$')
            && roster.values().join(' ').matches('^[a-z0-9][a-z0-9._-]{1,23}( [a-z0-9][a-z0-9._-]{1,23})*$')
            && roster.values().toSet().size() == roster.size()));
    }

    // tasks: { taskId: title }, at most 30; taskId 6 x [a-z0-9]; title 1-60 characters, one line.
    function validTasks(tasks) {
      return tasks is map
        && tasks.size() <= 30
        && (tasks.size() == 0
          || (tasks.keys().join(' ').matches('^[a-z0-9]{6}( [a-z0-9]{6})*$')
            && tasks.values().join('\n').matches('^[^\n]{1,60}(\n[^\n]{1,60})*$')));
    }

    // Fields every version of a class must satisfy (create and update).
    function validClassFields(d) {
      return textUpTo(d.name, 60) && d.name.size() > 0
        && textUpTo(d.teacherName, 60)
        && validRoster(d.roster)
        && d.joinOpen is bool
        && (d.joinWindowAt == null || d.joinWindowAt is timestamp)
        && d.rejoin is map
        && d.rejoin.size() <= 100
        && d.rejoin.keys().hasOnly(d.roster.keys())
        && d.handinsOpen is bool
        && validTasks(d.tasks)
        && (d.currentTaskId == '' || d.currentTaskId in d.tasks)
        && d.keepWeeks is int && d.keepWeeks >= 1 && d.keepWeeks <= 52
        && d.deleting is bool;
    }

    // ------------------------------------------------------------ classes

    match /classes/{code} {
      // Anyone signed in who knows the code may read the class (name, teacher name, roster, tasks).
      // Listing is only for the owner's own classes: the query must say where('ownerUid', '==', uid).
      allow get: if signedIn();
      allow list: if isTeacher() && resource.data.ownerUid == request.auth.uid;

      allow create: if isTeacher()
        && validCode(code)
        && exactKeys(request.resource.data,
             ['schema', 'ownerUid', 'name', 'teacherName', 'roster', 'joinOpen', 'joinWindowAt',
              'rejoin', 'handinsOpen', 'tasks', 'currentTaskId', 'keepWeeks', 'deleting',
              'createdAt', 'updatedAt'])
        && request.resource.data.schema == 1
        && request.resource.data.ownerUid == request.auth.uid
        && validClassFields(request.resource.data)
        && request.resource.data.rejoin.size() == 0
        && request.resource.data.deleting == false
        && (request.resource.data.joinWindowAt == null || request.resource.data.joinWindowAt == request.time)
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time;

      allow update: if isTeacher()
        && resource.data.ownerUid == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['name', 'teacherName', 'roster', 'joinOpen', 'joinWindowAt', 'rejoin',
                       'handinsOpen', 'tasks', 'currentTaskId', 'keepWeeks', 'deleting', 'updatedAt'])
        && validClassFields(request.resource.data)
        // A join window always starts at the server's time (serverTimestamp()), so a wrong clock on
        // the teacher's computer cannot open joining for days.
        && (request.resource.data.joinWindowAt == resource.data.joinWindowAt
          || request.resource.data.joinWindowAt == null
          || request.resource.data.joinWindowAt == request.time)
        && request.resource.data.updatedAt == request.time;

      allow delete: if canDelete();

      // ---------------------------------------------------------- members
      // One doc per device (anonymous uid) that joined: binds the uid to a roster studentId.
      // Written once by the student (join); afterwards only the hand-in counter moves.
      // "Sign out" on the student side signs in as a NEW anonymous uid instead.

      match /members/{uid} {
        allow get: if (signedIn() && request.auth.uid == uid) || ownsExisting();
        allow list: if ownsClass(code);

        allow create: if signedIn() && request.auth.uid == uid && validJoinShape() && validJoinClass(code);

        // The hand-in counter: only in the same batch as a new hand-in (see validHandinClass).
        allow update: if signedIn() && request.auth.uid == uid && validHandinTick(code);

        // "Remove this computer": the teacher only (students cannot reset the counter this way).
        allow delete: if canDelete();
      }

      function validJoinShape() {
        let d = request.resource.data;
        return exactKeys(d, ['studentId', 'username', 'ownerUid', 'joinedAt', 'device',
                             'handinCount', 'lastHandinAt', 'lastHandinId'])
          && d.studentId is string
          && d.username is string
          && d.joinedAt == request.time
          && textUpTo(d.device, 40)
          && d.handinCount == 0
          && d.lastHandinAt == null
          && d.lastHandinId == '';
      }

      // Joining is allowed while it is switched on, during a 15-minute class window, or during a
      // 15-minute window the teacher opened for this one student ("Let ali.k join again").
      function joinAllowed(cls, studentId) {
        return cls.joinOpen == true
          || (cls.joinWindowAt != null && request.time < cls.joinWindowAt + duration.value(15, 'm'))
          || (studentId in cls.rejoin && request.time < cls.rejoin[studentId] + duration.value(15, 'm'));
      }

      function validJoinClass(code) {
        let d = request.resource.data;
        let cls = classDoc(code);
        return cls.deleting == false
          && cls.handinsOpen == true
          && d.studentId in cls.roster
          && d.username == cls.roster[d.studentId]
          && d.ownerUid == cls.ownerUid
          && joinAllowed(cls, d.studentId);
      }

      function validHandinTick(code) {
        let d = request.resource.data;
        let before = resource.data;
        return d.diff(before).affectedKeys().hasOnly(['handinCount', 'lastHandinAt', 'lastHandinId'])
          && d.handinCount == before.handinCount + 1
          && d.handinCount <= 300
          && d.lastHandinAt == request.time
          && (before.lastHandinAt == null || request.time > before.lastHandinAt + duration.value(10, 's'))
          && validAutoId(d.lastHandinId)
          && tickMatchesNewHandin(code, d.lastHandinId);
      }

      // The tick must point at a hand-in of this device created by this very request:
      // hand-ins are never updated by students and createdAt is immutable, so an older hand-in
      // cannot have createdAt == request.time.
      function tickMatchesNewHandin(code, hid) {
        let h = getAfter(subPath(code, 'handins', hid)).data;
        return h.uid == request.auth.uid && h.createdAt == request.time;
      }

      // --------------------------------------------------------- hand-ins
      // Created by a joined student in ONE batch of two writes: handins/{id} + members/{uid} tick.
      // Students never update or delete them. The teacher may re-file one (student / task) or delete it.

      match /handins/{hid} {
        // A student reads only what this device handed in; the teacher reads the whole class.
        // Student query: where('uid', '==', uid). Teacher query: any (checked with one read of the class).
        allow get: if (signedIn() && resource.data.uid == request.auth.uid) || ownsExisting();
        allow list: if (signedIn() && resource.data.uid == request.auth.uid) || ownsClass(code);

        allow create: if signedIn() && validAutoId(hid) && validHandinShape() && validHandinClass(code, hid);

        // "Wrong student? Move to..." / "Wrong task? Move to...": the owner only, nothing else changes.
        allow update: if ownsExisting() && validRefile(code);

        allow delete: if canDelete();
      }

      // Sketch and blocks: either plain strings (enc 'plain', sizes in UTF-8 bytes) or gzip bytes
      // (enc 'gzip'); a Code hand-in has an empty workspace, a Blocks hand-in a non-empty one.
      function validContent(d) {
        return ((d.enc == 'plain'
                  && d.code is string && d.workspace is string
                  && d.code.toUtf8().size() <= 50000
                  && d.workspace.toUtf8().size() <= 100000)
              || (d.enc == 'gzip'
                  && d.code is bytes && d.workspace is bytes
                  && d.code.size() <= 50000
                  && d.workspace.size() <= 100000))
          && d.code.size() > 0
          && (d.kind == 'blocks' ? d.workspace.size() > 0 : d.workspace.size() == 0);
      }

      function validHandinShape() {
        let d = request.resource.data;
        return exactKeys(d, ['uid', 'studentId', 'username', 'ownerUid', 'kind', 'taskId', 'title',
                             'note', 'createdAt', 'enc', 'code', 'workspace'])
          && d.uid == request.auth.uid
          && d.studentId is string
          && d.username is string
          && d.ownerUid is string
          && d.taskId is string
          && d.kind in ['code', 'blocks']
          && textUpTo(d.title, 80)
          && textUpTo(d.note, 500)
          && d.createdAt == request.time
          && validContent(d);
      }

      function validHandinClass(code, hid) {
        let d = request.resource.data;
        let cls = classDoc(code);
        let member = getAfter(subPath(code, 'members', request.auth.uid)).data;
        return cls.deleting == false
          && cls.handinsOpen == true
          && d.ownerUid == cls.ownerUid
          && d.studentId == member.studentId
          && d.username == cls.roster[d.studentId]
          && (d.taskId == '' || d.taskId in cls.tasks)
          && member.lastHandinId == hid
          && member.lastHandinAt == request.time;
      }

      function validRefile(code) {
        let d = request.resource.data;
        let cls = classDoc(code);
        return d.diff(resource.data).affectedKeys().hasOnly(['studentId', 'username', 'taskId'])
          && d.studentId is string
          && d.studentId in cls.roster
          && d.username == cls.roster[d.studentId]
          && d.taskId is string
          && (d.taskId == resource.data.taskId || d.taskId == '' || d.taskId in cls.tasks);
      }
    }

    // Everything else (including collection-group queries) is closed.
  }
}
```

### 3.2 Notes for Dev A

- **Billing of rule reads.** `get()`, `exists()`, `getAfter()` and `existsAfter()` each
  count as a **billed read**, once per document per request, **also when the request is
  denied**.
  - Access-call limits: 10 per single-document request or query; 20 per batch or
    transaction; 10 per operation.
  - The hand-in batch uses 3 calls on 3 distinct documents. Teacher deletes use none.
- **Order of checks.** Conditions check the request alone first and read documents
  last. Rules short-circuit `&&` and `||`, so a malformed request costs no read.
- **Sizes.** `string.size()` counts characters. The client cuts titles and notes by
  UTF-16 length (`.length`), which is never smaller, so a value the client accepts
  always passes. Content limits are in UTF-8 bytes on both sides
  (`new TextEncoder().encode(s).length` ↔ `toUtf8().size()`), or in bytes for gzip.
- **Teachers** must be `google.com` sign-ins with `email_verified == true`.
  - A token with no `email_verified` claim is denied: safe direction, and rare for
    Google.
  - Other providers and smuggled claims are denied (R1.2).
  - To restrict teachers to some schools later, extend `isTeacher()` with an email-domain
    regex (see the comment in the rules).
  - Microsoft sign-in later = `sign_in_provider in ['google.com', 'microsoft.com']`.
- **`join()` coercion.** See §2.4 (R2.6).

### 3.3 Threats and how the rules stop them

| threat | stopped by | tests |
|---|---|---|
| reading another teacher's class list | `list` only with `ownerUid == auth.uid` (the query must say so) | R3.3 |
| reading another teacher's roster, members or hand-ins | members `list` = `ownsClass` (a get of the class); hand-ins `list` = own uid or `ownsClass`; single gets check the copied `ownerUid` | R5.2, R7.4 |
| a student reading other students' hand-ins | hand-ins readable only when `uid == auth.uid`; sign-out gives a new uid | R7.1, e2e |
| handing in as another username without joining as them | the hand-in `studentId` must equal the member doc's; member docs are create-only and bound to the uid | R6.5, R4.8 |
| cross-class hand-in, batch cross-wiring, re-using an old hand-in for the tick | member path is the same class; tick bound to a hand-in created by *this* request | R6.4, R6.5, R4.9, R6.15 |
| forging `createdAt`, `username`, `uid`, `ownerUid`, class | `createdAt == request.time`; `username == roster[studentId]`; `uid == auth.uid`; `ownerUid == class.ownerUid`; the class is the path | R6.6 |
| editing or deleting a hand-in after submission (student) | no student update or delete | R7.2 |
| re-filing a hand-in to a non-roster name / changing its content | `validRefile`: only `studentId` + `username` (matching the roster) + `taskId`, owner only | R7.6 |
| roster, task or joining tampering by students | class `update` is owner-only | R3.10 |
| joining a closed class, or opening joining with a wrong clock | `joinAllowed` with server-time windows; `joinWindowAt == request.time` when set | R4.2, R4.3, R3.6 |
| joining or handing in to a stopped / deleting class | `handinsOpen == true`, `deleting == false` | R4.4, R6.14 |
| enumerating classes through list queries | no `list` on classes except own; no collection-group rules | R3.3, R7.5 |
| oversize documents | every string capped; content capped in UTF-8 bytes or gzip bytes; roster ≤ 100, tasks ≤ 30 | R6.8, R2.* |
| wrong encoding / gzip bombs | `enc` must match the field types; the dashboard inflates with a cap | R6.3, e2e |
| unexpected fields | `exactKeys` on every create; `affectedKeys().hasOnly` on every update | R1.5, R4.6, R6.6 |
| hand-in flooding from one identity | 10 s cooldown + 300 per device in the member tick (best effort, §2.7) | R6.10, R6.11 |
| handing in after removal from the list | `roster[studentId]` must exist | R6.12 |
| anonymous users acting as teachers | `isTeacher()` requires `google.com` + verified email | R1.2 |
| a failed or duplicated delete batch | deleting a missing doc is allowed | R3.11, R5.3, R7.7 |
| writing anywhere else (including the old `handinCode`) | no other `match` | R8.2 |

### 3.4 Running student code safely (MUST, v1)

**The problem** (Security review, blocker 1, confirmed again here in Chromium):
- The transpiler compiles C++ to JavaScript that runs through `new Function`.
- `Serial.constructor.constructor("<js>").call()` transpiles cleanly and runs arbitrary
  JavaScript on the page's origin.
- `index.html` and `teacher.html` share the origin `ebechalani.github.io`. A hand-in
  opened in the simulator could therefore read that origin's storage and take over a
  teacher account.

**The fix**: three layers.

1. **Sandboxed review page (primary).** The dashboard **never** opens a hand-in on the
   site's origin. **Open** links go to `review.html` (§1.4, §4.14), which runs the
   simulator in `<iframe sandbox="allow-scripts">`.
   - The frame gets an **opaque origin**. Verified:
     - `localStorage`, `indexedDB` and `parent.*` throw `SecurityError`;
     - `window.open` returns `null` (no `allow-popups`);
     - without `allow-top-navigation` it cannot navigate the dashboard;
     - with no `allow-downloads` or `allow-modals` it cannot trigger downloads or dialogs;
     - CSP `frame-src 'self'` on the review page stops it from navigating the frame to a
       phishing site.
   - The sandbox attribute is exactly `allow-scripts`. **MUST NOT** add
     `allow-same-origin`: together with `allow-scripts` it would cancel the sandbox.
   - What stays possible inside the frame: CPU use, fake UI inside the frame, network
     requests with the teacher's IP. There are no secrets there. The trusted banner sits
     outside the frame.
   - Review mode never runs on its own: the teacher presses Run.
2. **No teacher token in shared storage.** The teacher session is `browserSessionPersistence`
   only (D13).
   - A malicious same-origin page, for example an untrusted `#code=` share link that a
     teacher opens directly, cannot read another tab's sessionStorage.
   - Residual risk: such a page could `window.open('./teacher.html')` and wait for the
     teacher to sign in there. Layer 3 is the defence.
3. **Transpiler hardening X1** (B, v1 gate, defence in depth):
   - `codegen.ts` refuses member names `constructor`, `prototype`, `__proto__`,
     `caller`, `callee`, `arguments`, `call`, `apply`, `bind`, and any name starting
     with `__`. It refuses them in `MemberExpr`, in method calls (`genMethodCall`) and
     in index expressions with a constant string key. The compile error is "'{name}' is
     not available in the simulator".
   - The runtime `__m` / `__mut` (`src/runtime/libs/strings.ts`) refuse the same names,
     and refuse to invoke a function found on `Function.prototype` or
     `Object.prototype`.
   - Tests (`tests/codegen.test.ts`) cover the PoC (`Serial.constructor.constructor`),
     `Serial.begin.constructor`, `Serial.begin.call`, `obj.__proto__`, and a runtime
     call of `__m(fn, 'constructor', …)`. Each MUST fail to compile or throw a
     `SketchError`.

**Rendering (MUST).** Every user-controlled string is rendered with `textContent`,
never `innerHTML`. That covers `username`, `device`, `title`, `note`, `teacherName`,
class `name`, task titles and the code `<pre>`. It applies to the dashboard, the review
banner and the student dialog. §7.3 has a test matrix with stored `<img src=x
onerror=…>` and `</script>` payloads (R4.7 shows the rules accept them).

### 3.5 What the rules cannot stop

1. **Anyone with the code can pick any username while joining is allowed.** This is the
   same as Tinkercad nicknames (R4 "nickname model"). They still cannot read that
   student's earlier hand-ins.
   - Mitigations: joining closed by default outside windows (§2.6), device visibility,
     "2 computers within an hour", Remove computer, Move to…
2. **Shared computers.** The next person at a computer acts as the student who is still
   signed in.
   - Mitigations: the per-tab + 20-minute Confirm view, the name in the header, and
     "Leaving? Sign out" after each hand-in (S4-S6).
3. **Quota exhaustion (denial of service), shared by all schools.**
   - Anyone can load the public web config and sign in anonymously, up to 100 new
     accounts per hour per IP.
   - Every `get`, including a code guess or a read of a missing doc, is 1 billed read.
     Every **denied** write still bills its rule reads.
   - One script can therefore burn the 50,000 daily reads for **every** school. An
     attacker who knows an open class can also fill writes and storage from many uids.
   - On Spark, a spent quota stops that operation for everyone until the reset at
     midnight Pacific, which is 09:00-10:00 in Europe and the Middle East, during the
     school day.
   - The rules bound one identity (10 s, 300, sizes) but not the total.
   - The real defences are **App Check enforcement** and **Blaze with a budget**, both
     decided by the maintainer (§3.6).
4. **Any Google account can become a teacher** and create classes (storage). If this is
   abused, add a domain allow-list to `isTeacher()`.
5. **Content.** The rules cannot judge code, titles or notes (rudeness, personal data).
   The teacher deletes.
6. **Visible to anyone with the code**: the class name, teacher name, roster usernames,
   task titles and the teacher's Firebase `ownerUid` (R3.2).
   - `ownerUid` is an account identifier, not a credential. Every owner check needs to
     *be* that authenticated uid.
   - It is kept, because the member create rule and the teacher's read-free deletes use
     it (Security m3: documented, accepted).
   - No email is stored in Firestore.
7. **The maintainer**, as project owner, can read all data in the console. Schools must
   be told (§9).
8. **Same-origin share links** (`#code=` / `#blocks=` opened directly in the simulator)
   still run on the site origin, as they do today.
   - A malicious classmate could steal a student's anonymous session. The impact is
     impersonation of that student, which picking the name already allows.
   - X1 reduces this. Teachers are told to open student work only through the dashboard.

### 3.6 App Check and the abuse runbook (maintainer)

**App Check (D18).**
- The client supports it from v1:
  - `APP_CHECK_SITE_KEY` in `src/firebase-config.ts` (empty = off);
  - when set, `firebase.ts` calls `initializeAppCheck(app, { provider: new
    ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true })` before
    Firestore, in both apps.
- Setup step 9 registers it in **monitoring** mode.
- **Enforcement** of Firestore (and Authentication) is a maintainer decision, because of
  its own free tier:
  - reCAPTCHA Enterprise is free for **10,000 assessments a month**.
  - Without billing, "requests will return an error" after that.
  - Enforcing App Check in a large deployment would therefore become an outage in the
    middle of the month.
- Guidance:
  - Set the App Check token lifetime to **7 days**. Tokens refresh at about half their
    lifetime, so each device needs about 1 assessment per 3.5 days of use; lab PCs that
    wipe storage need 1 per session.
  - **Enforce** when the App Check metrics (console) show under about 8,000 assessments
    a month, roughly under 500 students, or when billing is enabled.
  - Otherwise stay in monitoring mode, and **enforce during an attack** (it takes effect
    within minutes), accepting the monthly ceiling.
  - On Spark only the score levels 0.1 / 0.3 / 0.7 / 0.9 exist. Keep the default
    threshold 0.5.

**Runbook** when usage spikes or a school reports junk hand-ins:
1. Firestore → Usage, and Authentication → Usage: which operation, since when.
2. If one class is abused (the teacher reports it):
   - in the console, set that class's `joinOpen: false` and `joinWindowAt: null` (or
     `handinsOpen: false`);
   - delete the offending member docs;
   - ask the teacher to use Remove computer.
3. Script abuse across classes:
   - turn on App Check **enforcement** for Firestore and Authentication;
   - if needed, temporarily **disable the Anonymous provider** (all new joins stop;
     joined devices keep working).
4. Afterwards:
   - disable abusive Auth users (Authentication → Users → by creation time);
   - consider Blaze with a budget alert (§6.3).

### 3.7 Per-student PIN (not in v1)

A 4-digit PIN would need printed slips and would stop only casual classmates. If schools
report impersonation, it can be added without migration:

- a new doc `classes/{code}/private/pins` = `{ pins: { studentId: '1234' } }`, readable
  and writable only by the owner (`ownsClass`);
- a class field `pinRequired: bool` (added to the allowed keys);
- the member create rule additionally requires `!cls.pinRequired ||
  request.resource.data.pin == get(…/private/pins).data.pins[studentId]`. The rules can
  read a doc the student cannot.

---

## 4. Client modules and UI

### 4.1 File map

```
src/firebase-config.ts            [A] public web config, APP_CHECK_SITE_KEY, CLASSROOM_DEFAULTS (empty config = not configured)
src/share-link.ts                 [A] #code= / #blocks= / #class= / review payload encode-decode (pure)
src/classroom/model.ts            [A] types, constants, validation, pure helpers
src/classroom/codec.ts            [A] encodeContent / decodeContent (CompressionStream; no Firebase)
src/classroom/errors.ts           [A] ClassroomError, code mapping, texts, quotaResetText
src/classroom/session-store.ts    [A] z1.classroom localStorage + tab confirm flag (pure)
src/classroom/firebase.ts         [A] config detection, lazy loaders, App Check, emulator hook
src/classroom/student-sdk.ts      [A] ONLY file importing firebase/app, auth, firestore/lite (+ app-check)
src/classroom/teacher-sdk.ts      [A] ONLY file importing firebase/app, auth, firestore (+ app-check)
src/classroom/student.ts          [A] StudentApi
src/classroom/teacher.ts          [A] TeacherApi
scripts/check-bundle.mjs          [A] post-build chunk checks (§7.5)
src/ui/handin-dialog.ts           [B] Hand in dialog
src/ui/app.ts                     [B] header button, #class=, review mode, mode-from-link fix, update prompt
teacher.html, review.html         [C] extra Vite pages
src/teacher/main.ts               [C] entry; dashboard views split as C likes (dashboard.ts, overview.ts, students.ts, ...)
src/teacher/zip.ts                [C] store-only zip writer (CRC-32, no dependency)
src/teacher/teacher.css           [C]
src/review/main.ts                [C] review page
```

### 4.2 Bundle boundary (MUST)

- No module reachable by static imports from `src/main.ts`, `src/teacher/main.ts` or
  `src/review/main.ts` may import `firebase/*`, except with `import type`.
- `student-sdk.ts` and `teacher-sdk.ts` re-export only the functions used, so they
  tree-shake. They are loaded only through `import('./student-sdk')` /
  `import('./teacher-sdk')` inside `firebase.ts`.
- `firebase/app-check` is imported only from inside those two files, behind the same
  dynamic import. The reCAPTCHA script is fetched only when `APP_CHECK_SITE_KEY` is set.
- `handin-dialog.ts` loads `import('../classroom/student')` on first open. `student.ts`
  loads the SDK only when a network operation is needed; `restore()` with nothing saved
  downloads nothing.
- `review.html` imports no Firebase and no classroom module except
  `src/share-link.ts` and `src/ui/sketch-file.ts`.
- Measured (Feasibility 8, Vite 6.4.3 multi-page):
  - the student chunks are about **62 KB gzip**;
  - the teacher chunks about **170 KB gzip** with the memory cache;
  - the simulator entry chunk has no Firebase code.
  - Rollup shares a chunk between the pages (named e.g. `bloom_blob_es2018-*.js`).
    Therefore `tests/bundle-boundary.test.ts`, a source scan, is complemented by
    `scripts/check-bundle.mjs` (§7.5).

`student-sdk.ts` (reference):

```ts
export { initializeApp, getApps } from 'firebase/app';
export {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  signInAnonymously, signOut, deleteUser,
} from 'firebase/auth';
export {
  getFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, setDoc, writeBatch,
  query, where, orderBy, limit, startAfter, serverTimestamp, increment, Timestamp, Bytes,
} from 'firebase/firestore/lite';
export { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
```

`teacher-sdk.ts` (reference):
- from `firebase/app`: `initializeApp`, `getApps`;
- from `firebase/auth`: `initializeAuth`, `browserSessionPersistence`,
  `browserPopupRedirectResolver`, `GoogleAuthProvider`, `signInWithPopup`,
  `reauthenticateWithPopup`, `onAuthStateChanged`, `signOut`, `deleteUser`,
  `connectAuthEmulator`;
- from `firebase/firestore`: `initializeFirestore`, `memoryLocalCache`,
  `connectFirestoreEmulator`, `doc`, `collection`, `getDoc`, `getDocs`,
  `getCountFromServer`, `onSnapshot`, `runTransaction`, `writeBatch`, `updateDoc`,
  `deleteDoc`, `deleteField`, `query`, `where`, `orderBy`, `limit`, `startAfter`,
  `serverTimestamp`, `Timestamp`, `Bytes`;
- from `firebase/app-check`: `initializeAppCheck`, `ReCaptchaEnterpriseProvider`.

### 4.3 `src/classroom/firebase.ts`

```ts
export const STUDENT_APP_NAME = 'z1-student';
export const TEACHER_APP_NAME = 'z1-teacher';
export const EMULATOR_PROJECT_ID = 'demo-zero1';

/** True in `vite --mode emulator` (import.meta.env.VITE_CLASSROOM_EMULATOR === '1'). */
export function usesEmulator(): boolean;
/** The emulator demo config; else FIREBASE_CONFIG when apiKey, authDomain, projectId and appId are all non-empty; else null. */
export function activeFirebaseConfig(): FirebaseWebConfig | null;
/** activeFirebaseConfig() !== null. Synchronous, no Firebase import. */
export function isClassroomConfigured(): boolean;

export type StudentSdk = typeof import('./student-sdk');
export type TeacherSdk = typeof import('./teacher-sdk');
export interface StudentFirebase { app: FirebaseApp; auth: Auth; db: LiteFirestore; sdk: StudentSdk }
export interface TeacherFirebase { app: FirebaseApp; auth: Auth; db: Firestore; sdk: TeacherSdk }

/**
 * Download (once, memoised) and initialise the student side:
 * - named app 'z1-student';
 * - App Check when APP_CHECK_SITE_KEY is set (not in emulator mode);
 * - initializeAuth with [indexedDBLocalPersistence, browserLocalPersistence] and no popup resolver;
 * - Firestore Lite; the emulators in emulator mode.
 * Rejects with 'not_configured', 'load_failed' or 'app_updated'.
 * A failed import() is not memoised: the next call retries.
 */
export function loadStudentFirebase(): Promise<StudentFirebase>;
/**
 * The same for the teacher:
 * - app 'z1-teacher';
 * - initializeAuth with persistence [browserSessionPersistence] and
 *   popupRedirectResolver = browserPopupRedirectResolver;
 * - initializeFirestore with localCache = memoryLocalCache().
 * Called at page load by the dashboard (not on click).
 */
export function loadTeacherFirebase(): Promise<TeacherFirebase>;
```

- Emulator hosts: auth `http://127.0.0.1:9099`, firestore `127.0.0.1:8080`.
- Demo config: `{ apiKey: 'demo-key', authDomain: 'demo-zero1.firebaseapp.com',
  projectId: 'demo-zero1', appId: 'demo-app' }`.
- `app_updated` detection: the import fails, and a `HEAD` of `./index.html` succeeds, or
  the error is a `vite:preloadError`.

### 4.4 `src/classroom/model.ts` (pure; no DOM, no Firebase)

```ts
export const CLASS_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ3479';
export const CLASS_CODE_LENGTH = 6;
export const CODE_LOOKALIKES: Readonly<Record<string, string>> = { '2': 'Z', '5': 'S', '6': 'G', '8': 'B' };
export const STUDENT_ID_LENGTH = 8;  // [a-z0-9]
export const TASK_ID_LENGTH = 6;     // [a-z0-9]
export const LIMITS = {
  classNameMax: 60, teacherNameMax: 60, rosterMax: 100, tasksMax: 30, taskTitleMax: 60,
  usernameMin: 2, usernameMax: 24, titleMax: 80, noteMax: 500, deviceMax: 40,
  codeMaxBytes: 50_000, workspaceMaxBytes: 100_000,
  /** Inflate caps for stored content (2× the raw limits): beyond them = 'too_large'. */
  codeDecodeCap: 100_000, workspaceDecodeCap: 200_000,
  handinsPerDevice: 300, handinCooldownMs: 10_000,
  joinWindowMs: 15 * 60_000, clockSkewMs: 60_000,
  /** Ask "Hand in as <name>?" when a saved session was last used longer ago (or in a new tab). */
  confirmAfterMs: 20 * 60_000,
  keepWeeksMin: 1, keepWeeksMax: 52,
  requestTimeoutMs: 20_000, batchMaxOps: 400, deletesPerRun: 5_000, prunePerOpen: 500,
  todayLimit: 300, periodPage: 100, studentPage: 10, myHandinsPage: 20, membersWatchLimit: 150,
  reviewHashMax: 60_000,
} as const;
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,23}$/;

export type HandinKind = 'code' | 'blocks';
export type Roster = Readonly<Record<string, string>>;
export interface RosterEntry { studentId: string; username: string }
export interface TaskEntry { taskId: string; title: string }

export function normalizeClassCode(input: string): string | null;       // 'bkt-4m9 ' → 'BKT4M9'; '8KT' → 'BKT'…
export function codeProblem(input: string): string | null;              // 'Class codes never contain the letter A.'
export function formatClassCode(code: string): string;                  // 'BKT4M9' → 'BKT-4M9'
export function classLink(code: string, base?: string): string;         // new URL('./#class=BKT4M9', base ?? location.href)
export function generateClassCode(randomBytes?: (n: number) => Uint8Array): string;
export function newStudentId(existing: Roster, randomBytes?: (n: number) => Uint8Array): string;
export function newTaskId(existing: Readonly<Record<string, string>>, randomBytes?: (n: number) => Uint8Array): string;
export function newHandinId(randomBytes?: (n: number) => Uint8Array): string; // 20 × [A-Za-z0-9], rejection sampling

export function normalizeUsername(input: string, options?: { shortenLastName?: boolean }): string;
export type UsernameProblem = 'empty' | 'too_short' | 'too_long' | 'invalid';
export function usernameProblem(name: string): UsernameProblem | null;
export function nearDuplicates(names: readonly string[]): [string, string][]; // Levenshtein distance 1
export function sortedRoster(roster: Roster): RosterEntry[];                   // by username, locale-independent
export function sortedTasks(tasks: Readonly<Record<string, string>>): TaskEntry[];

export type RosterProblemReason = UsernameProblem | 'duplicate' | 'already_in_class' | 'too_many';
export interface RosterPlan {
  add: RosterEntry[];   // new entries with fresh studentIds, in input order
  problems: { line: number; input: string; normalized: string; reason: RosterProblemReason }[];
  warnings: { names: [string, string]; reason: 'near_duplicate' }[];
}
export function planRosterAdd(existing: Roster, text: string, options?: { shortenLastName?: boolean; randomBytes?: (n: number) => Uint8Array }): RosterPlan;
export function planTasksAdd(existing: Readonly<Record<string, string>>, text: string, randomBytes?: (n: number) => Uint8Array): { add: TaskEntry[]; problems: { line: number; reason: 'too_long' | 'too_many' | 'duplicate' }[] };

export interface JoinState { joinOpen: boolean; joinWindowAt: Date | null; rejoin: Readonly<Record<string, Date>> }
/** The rules' joinAllowed() on the client, with clockSkewMs tolerance ('open' when unsure). */
export function joinStatus(cls: JoinState, studentId: string | null, nowMs: number): { open: boolean; until: Date | null };

export function cleanLine(text: string, max: number): string;       // one line; invisible chars removed; trimmed; cut (no half surrogate)
export function cleanMultiline(text: string, max: number): string;  // CRLF→LF; ≤ 1 empty line in a row; trimmed; cut
export function utf8Length(text: string): number;
export function deviceLabel(userAgent: string): string;             // 'Chrome · Windows' (≤ 40)
export function shortDeviceId(uid: string): string;                 // last 4 chars, uppercase

export interface HandinDraft {
  kind: HandinKind;
  code: string;          // the Arduino sketch (Blocks: generated)
  workspaceJson: string; // '' in Code mode
  taskId: string;        // '' = no task
  title: string;
  note: string;
}
export interface HandinContent { kind: HandinKind; code: string; workspaceJson: string }
export interface HandinRecord {
  id: string; classCode: string; uid: string; studentId: string; username: string;
  kind: HandinKind; taskId: string; title: string; note: string;
  createdAt: Date | null;      // server time; for a hand-in this device just made: local time
  content: EncodedContent;     // still encoded (codec.ts)
}
export function draftProblem(draft: HandinDraft): 'empty_sketch' | 'too_large' | null;
```

`cleanLine` / `cleanMultiline` are the current `cleanName` / `cleanMessage` of
share-dialog.ts, generalised with a `max` parameter. The code and its tests move here.

### 4.5 `src/classroom/codec.ts` (pure; A)

```ts
export type ContentEncoding = 'plain' | 'gzip';
export interface EncodedContent { enc: ContentEncoding; code: string | Uint8Array; workspace: string | Uint8Array }
/** gzip both fields when CompressionStream exists and the gzip total is smaller; else plain strings. */
export function encodeContent(code: string, workspaceJson: string, options?: { compress?: boolean }): Promise<EncodedContent>;
export type DecodeResult = { ok: true; code: string; workspaceJson: string } | { ok: false; problem: 'too_large' | 'corrupt' | 'unsupported' };
/** Inflate with LIMITS.*DecodeCap; 'unsupported' when DecompressionStream is missing. */
export function decodeContent(content: EncodedContent): Promise<DecodeResult>;
```

`student.ts` and `teacher.ts` convert between `Uint8Array` and Firestore `Bytes`
(`Bytes.fromUint8Array` / `.toUint8Array()`).

### 4.6 `src/classroom/errors.ts` and `session-store.ts`

```ts
export type ClassroomErrorCode =
  | 'not_configured' | 'load_failed' | 'app_updated' | 'offline' | 'timeout' | 'quota' | 'signup_limit'
  | 'auth_disabled' | 'storage_blocked' | 'popup_blocked' | 'popup_closed' | 'unauthorized_domain'
  | 'recent_login' | 'not_ready' | 'index_missing' | 'bad_code' | 'class_not_found' | 'class_closed'
  | 'handins_closed' | 'class_deleted' | 'lost_identity' | 'not_on_roster' | 'device_removed' | 'too_soon'
  | 'limit_reached' | 'empty_sketch' | 'too_large' | 'code_collision' | 'bad_roster' | 'classes_left'
  | 'permission' | 'unknown';

export class ClassroomError extends Error {
  constructor(readonly code: ClassroomErrorCode, message?: string, options?: { cause?: unknown });
}
export function toClassroomError(err: unknown, context: 'student' | 'teacher'): ClassroomError;  // table §1.5
export function withTimeout<T>(promise: Promise<T>, ms?: number): Promise<T>;                     // rejects 'timeout'
export const STUDENT_ERROR_TEXT: Readonly<Record<ClassroomErrorCode, string>>;
export const TEACHER_ERROR_TEXT: Readonly<Record<ClassroomErrorCode, string>>;
export function errorText(table: Readonly<Record<ClassroomErrorCode, string>>, code: ClassroomErrorCode, vars?: Record<string, string>): string;
/** Next midnight America/Los_Angeles as local time text ('10:00'); via Intl, DST-correct. */
export function quotaResetText(now: Date, locale?: string): string;
```

```ts
// session-store.ts
export const CLASSROOM_STORAGE_KEY = 'z1.classroom';
export const LAST_CODE_STORAGE_KEY = 'z1.classroom.lastCode';
export const CONFIRMED_SESSION_KEY = 'z1.classroom.confirmed';  // sessionStorage
export interface SavedSession {
  v: 1; code: string; className: string; teacherName: string;
  studentId: string; username: string; uid: string;
  lastUsedAt: number;        // ms since epoch
  lastHandinAt: number;      // 0 = never
  lastHandinTitle: string;   // task title or title of the last hand-in ('' = none)
}
export function loadSavedSession(storage?: Storage): SavedSession | null;   // null on bad JSON / wrong shape / throwing storage
export function saveSession(session: SavedSession, storage?: Storage): void; // swallows storage errors
export function clearSession(storage?: Storage, tabStorage?: Storage): void;
export function loadLastCode(storage?: Storage): string;
export function saveLastCode(code: string, storage?: Storage): void;
export function isConfirmedInTab(uid: string, tabStorage?: Storage): boolean;
export function markConfirmedInTab(uid: string, tabStorage?: Storage): void;
/** The joined username, '' when none: header label and .ino file names (Share, Arduino IDE dialog). */
export function currentUsername(storage?: Storage): string;
```

### 4.7 `src/classroom/student.ts` (StudentApi)

```ts
export interface StudentSession { code: string; className: string; teacherName: string; studentId: string; username: string; uid: string }
export interface PublicClass extends JoinState {
  code: string; name: string; teacherName: string; ownerUid: string; handinsOpen: boolean;
  students: RosterEntry[];   // sorted
  tasks: TaskEntry[];        // sorted by title
  currentTaskId: string;
}
export interface FoundClass { info: PublicClass; existing: { studentId: string; username: string } | null }
export interface RestoreResult {
  session: StudentSession;
  info: PublicClass;
  /** 'new_tab': not confirmed in this tab; 'stale': last used > LIMITS.confirmAfterMs ago; null: go straight to Ready. */
  confirm: 'new_tab' | 'stale' | null;
  lastHandin: { at: number; title: string } | null;
}

export interface StudentApi {
  /**
   * The saved session, checked. Steps:
   * - await auth.authStateReady();
   * - check that it is the same anonymous uid (else 'lost_identity': saved session cleared, lastCode kept);
   * - read the class (1 read): it exists, is not deleting, hand-ins are open, the studentId is still on the roster;
   * - refresh and save the names.
   * The member doc is NOT read here (checked on hand-in failure).
   * Null when nothing is saved: no Firebase download then.
   * Rejects: lost_identity | class_deleted | handins_closed | not_on_roster | offline | timeout | quota | load_failed | app_updated.
   */
  restore(): Promise<RestoreResult | null>;
  /**
   * Normalise → sign in anonymously if needed → get the class + own member doc (2 reads).
   * Rejects: bad_code | class_not_found | handins_closed | offline | timeout | signup_limit | auth_disabled | storage_blocked | quota | load_failed | app_updated.
   */
  findClass(codeInput: string): Promise<FoundClass>;
  /** Re-read the class ("Refresh the list"). */
  refreshClass(code: string): Promise<PublicClass>;
  /**
   * Create the member doc, save the session, mark it confirmed in this tab.
   * Rejects: class_closed | handins_closed | not_on_roster | class_not_found | offline | timeout | quota | permission.
   */
  join(cls: PublicClass, studentId: string): Promise<StudentSession>;
  /** Use FoundClass.existing; save the session; mark it confirmed. */
  continueAs(found: FoundClass): Promise<StudentSession>;
  /** "Yes, I'm ali.k": mark confirmed in this tab, set lastUsedAt. */
  confirm(session: StudentSession): void;
  /**
   * draftProblem → local cooldown → encodeContent → the 2-write batch with `handinId` (§2.9).
   * On timeout / offline / unknown / permission-denied: read own member doc; lastHandinId === handinId → success.
   * Otherwise diagnose (read class + member). If only the username changed: save it and retry once with the SAME id.
   * Resolves with the new record (createdAt = local time) and updates lastHandinAt / lastHandinTitle.
   * Rejects: empty_sketch | too_large | too_soon | limit_reached | not_on_roster | device_removed | class_deleted | handins_closed | offline | timeout | quota | permission | index_missing.
   */
  handIn(session: StudentSession, draft: HandinDraft, handinId: string): Promise<HandinRecord>;
  /**
   * Newest first, 20 per page; `before` = createdAt of the last row.
   * Rejects index_missing when the composite index is absent (no fallback).
   */
  myHandins(session: StudentSession, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  /** Delete the anonymous user if possible (errors ignored), sign out, clear the session and the tab flag (lastCode kept unless forgetCode). */
  leave(options?: { forgetCode?: boolean }): Promise<void>;
}

export interface StudentApiDeps {
  load?: () => Promise<StudentFirebase>;  // default loadStudentFirebase
  storage?: Storage;                       // default localStorage
  tabStorage?: Storage;                    // default sessionStorage
  now?: () => number;
  userAgent?: string;
  timeoutMs?: number;
}
export function createStudentApi(deps?: StudentApiDeps): StudentApi;

/** Pure: why a hand-in was refused, from fresh reads. 'renamed' = only the username differs. */
export function diagnoseHandinRefusal(
  cls: { roster: Roster; deleting: boolean; handinsOpen: boolean; tasks: Record<string, string> } | null,
  member: { studentId: string; handinCount: number; lastHandinAt: Date | null; lastHandinId: string } | null,
  session: StudentSession, draft: HandinDraft, handinId: string, now: number,
): ClassroomErrorCode | 'renamed' | 'arrived';
```

Diagnosis order:
1. `member.lastHandinId === handinId` → `arrived`.
2. class missing or deleting → `class_deleted`.
3. `!handinsOpen` → `handins_closed`.
4. member missing → `device_removed`.
5. `roster[member.studentId]` missing → `not_on_roster`.
6. `handinCount >= 300` → `limit_reached`.
7. `now − lastHandinAt < 10 s` (+1 s margin for clock skew) → `too_soon`.
8. roster name ≠ session username → `renamed`.
9. `draft.taskId` no longer a task → the task is cleared, and the dialog asks the student
   to pick again (`permission` with the message 'task').
10. otherwise → `permission`.

### 4.8 `src/classroom/teacher.ts` (TeacherApi)

```ts
export type Unsubscribe = () => void;
export interface TeacherUser { uid: string; name: string; email: string; photoURL: string | null }
export interface ClassSummary {
  code: string; name: string; teacherName: string; joinOpen: boolean; joinWindowAt: Date | null;
  handinsOpen: boolean; deleting: boolean; studentCount: number; createdAt: Date | null; updatedAt: Date | null;
}
export interface ClassDetail extends ClassSummary, JoinState {
  ownerUid: string; roster: Roster; students: RosterEntry[];
  tasks: TaskEntry[]; currentTaskId: string; keepWeeks: number;
}
export interface Member {
  uid: string; studentId: string; username: string; device: string;
  joinedAt: Date | null; handinCount: number; lastHandinAt: Date | null;
}
export interface HandinsUpdate { items: HandinRecord[]; added: string[]; modified: string[]; removed: string[] }
export interface NewClassInput {
  name: string; teacherName: string; students: RosterEntry[]; tasks: string[];
  joinOpen: boolean; keepWeeks?: number;
}
export type ClassPatch = Partial<Pick<ClassDetail, 'name' | 'teacherName' | 'joinOpen' | 'handinsOpen' | 'keepWeeks' | 'currentTaskId'>>;

export interface TeacherApi {
  /** Resolves when the SDK is loaded and the tab's session restored. The Sign-in button stays disabled until then. */
  readonly ready: Promise<void>;
  onUser(callback: (user: TeacherUser | null) => void): Unsubscribe;   // a non-Google user is signed out
  /**
   * MUST be called synchronously in the click handler, after `ready`.
   * Its first statement is signInWithPopup(auth, provider{prompt: 'select_account'}): no await before it.
   * Rejects not_ready if called earlier.
   */
  signIn(): Promise<TeacherUser>;
  signOut(): Promise<void>;

  watchClasses(onChange: (classes: ClassSummary[]) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  /** Transaction with up to 5 code attempts. Students/tasks already validated (else bad_roster). */
  createClass(input: NewClassInput): Promise<ClassDetail>;
  watchClass(code: string, onChange: (cls: ClassDetail | null) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  updateClass(code: string, patch: ClassPatch): Promise<void>;
  openJoinWindow(code: string): Promise<void>;                 // joinWindowAt = serverTimestamp()
  closeJoining(code: string): Promise<void>;                   // joinOpen false, joinWindowAt null
  letRejoin(code: string, studentId: string): Promise<void>;   // rejoin.<id> = serverTimestamp()

  addStudents(code: string, entries: RosterEntry[]): Promise<void>;
  renameStudent(code: string, studentId: string, username: string): Promise<void>;
  /** Roster + rejoin entry in one update, then that student's member docs (query where studentId == id). */
  removeStudent(code: string, studentId: string): Promise<void>;
  addTasks(code: string, entries: TaskEntry[]): Promise<void>;
  renameTask(code: string, taskId: string, title: string): Promise<void>;
  deleteTask(code: string, taskId: string): Promise<void>;     // clears currentTaskId when it pointed at it

  watchMembers(code: string, onChange: (members: Member[]) => void, onError: (e: ClassroomError) => void): Unsubscribe; // newest 150
  removeDevice(code: string, uid: string): Promise<void>;
  removeUnusedDevices(code: string, olderThanDays: number): Promise<number>;

  /** Since local midnight (re-subscribes at the date change), newest first, limit 300, live. */
  watchTodayHandins(code: string, onChange: (u: HandinsUpdate) => void, onError: (e: ClassroomError) => void): Unsubscribe;
  /** One-off, 100 per page. */
  loadHandins(code: string, since: Date, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  /** 10 per page; composite index; rejects index_missing. */
  studentHandins(code: string, studentId: string, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;
  refileHandin(code: string, id: string, patch: { studentId?: string; taskId?: string }): Promise<void>;
  deleteHandin(code: string, id: string): Promise<void>;

  countHandinsBefore(code: string, before: Date): Promise<number>;                // count() aggregation
  pruneHandins(code: string, before: Date, maxDeletes?: number): Promise<number>; // §2.11
  /** §2.11. 'more' when the budget ran out (class stays deleting: true). */
  deleteClass(code: string, onProgress?: (done: number, total: number | null) => void, budget?: number): Promise<'done' | 'more'>;
  deleteAllClasses(onProgress?: (text: string) => void): Promise<'done' | 'more'>;
  /**
   * Step 2 of T12. MUST be called synchronously in a click handler.
   * Rejects classes_left if any class remains; otherwise reauthenticateWithPopup, then deleteUser.
   */
  deleteAccount(): Promise<void>;
}
export interface TeacherApiDeps { load?: () => Promise<TeacherFirebase>; randomBytes?: (n: number) => Uint8Array; now?: () => number }
export function createTeacherApi(deps?: TeacherApiDeps): TeacherApi;   // starts loading at once
```

- All methods reject with `ClassroomError`, and `onError` callbacks receive one.
- Every Promise-returning network call goes through `withTimeout`.
- With the full SDK, a write that times out may still be applied later. The UI text says
  so. Deletes are idempotent (§2.11).

### 4.9 `src/share-link.ts` (pure; A)

Move these from `editor.ts` / `blocks-panel.ts` without changing behaviour:
`encodeShareCode`, `decodeShareCode`, `codeFromHash`, `encodeShareBlocks`,
`blocksFromHash`, `parseWorkspaceJson`. Then add:

```ts
/** '#class=BKT4M9' → 'BKT4M9' (normalised) or null. */
export function classFromHash(hash: string): string | null;
export interface ReviewPayload {
  v: 1; kind: 'code' | 'blocks'; code: string; workspaceJson: string;
  who: string; className: string; task: string; title: string; at: number;   // at = createdAt ms
}
export function encodeReviewPayload(p: ReviewPayload): string;          // base64url(UTF-8 JSON)
export function decodeReviewPayload(s: string): ReviewPayload | null;   // strict shape check
/** The review link: #review= when ≤ LIMITS.reviewHashMax, else #rid= plus a localStorage handoff. */
export function reviewLink(p: ReviewPayload, base?: string): { href: string; handoff: { key: string; value: string } | null };
/** For the student's own history: '#code=…' or '#blocks=…' (the #code= link when the workspace is not a JSON object). */
export function handinHash(content: { kind: 'code' | 'blocks'; code: string; workspaceJson: string }): { hash: string; fellBack: boolean };
```

`editor.ts` and `blocks-panel.ts` re-export the moved names (B), so existing imports and
tests keep working.

### 4.10 Hand in dialog (`src/ui/handin-dialog.ts`, B)

```ts
export interface HandinWork {
  kind: 'code' | 'blocks'; code: string; workspaceJson: string;
  /** Set by the App: untouched starting sketch / untouched example (with its title). */
  unchanged: { kind: 'blank' } | { kind: 'example'; title: string } | null;
  /** Transpiler errors in `code` (App runs the check synchronously), 0 when none. */
  errorCount: number;
}
export interface HandinDialogOptions {
  loadApi?: () => Promise<StudentApi>;   // default: () => import('../classroom/student').then((m) => m.createStudentApi())
  openWork?(content: HandinContent): void; // App: location.hash = handinHash(content).hash
  onSessionChange?(username: string): void; // App updates the header label ('' = not joined)
  toast?(text: string): void;
  confirm?(text: string): boolean;          // default window.confirm
  now?: () => Date;
  isOnline?: () => boolean;
}
export interface HandinDialog {
  open(work: HandinWork, options?: { joinCode?: string }): void;  // joinCode: #class= join mode (S0)
  close(): void; isOpen(): boolean; readonly element: HTMLDialogElement;
}
export function createHandinDialog(parent: HTMLElement, options?: HandinDialogOptions): HandinDialog;
```

- A `<dialog class="z1-dialog z1-handin">`, built like Share and the Arduino IDE dialog:
  `.z1-dialog-form`, `.z1-setting`, `.z1-btn-primary`, and a status line with
  `role="status" aria-live="polite"`.
- One view is visible at a time: `data-view="loading|code|pick|already|confirm|ready|success|switch|joined|error"`.
- Buttons carry `data-action`: `next`, `back`, `pick`, `refresh`, `continue`, `yes`,
  `other`, `different`, `signout`, `handin`, `anyway`, `retry`, `history`, `more`,
  `open`, `close`. Status elements carry `data-role`.
- Focus:
  - Code view → the code input;
  - Pick → the filter or the first radio;
  - Ready → Task (or Title);
  - Success → Close;
  - after an error → the control to fix.
- The dialog never keeps the student's work after closing; `open(work)` replaces it.
- All user strings go through `textContent`.

### 4.11 `src/ui/app.ts` changes (B)

**Header.**
- The button: `<button type="button" class="z1-btn" data-slot="handin" aria-label="Hand in your work to your teacher" title="Hand in: send this work to your teacher"><span aria-hidden="true">📥</span> <span class="z1-handin-label">Hand in</span><span class="z1-handin-name"></span></button>`.
- It is rendered only when `isClassroomConfigured()`.
- Order: New, Examples, Run, Stop, Reset, Settings, **Hand in**, Share, Arduino IDE.
- While joined, the name part is " · ali.k" with `max-width: 9ch; overflow: hidden;
  text-overflow: ellipsis`. The `aria-label` becomes "Hand in as ali.k to 8B Robotics".
- **Brand**: below 1536 px the header shows "ZERO1 Simulator". The full name stays in
  `<title>` and in visually hidden text.
- B re-measures at 1536, 1440, 1366, 1280, 1024, 768 and 375 px, with the longest
  run-status text ("Error at 12345 ms"). There must be one row from 1366 px up and no
  overflow at any width (Classroom UX M5).

**Other changes.**
- **Mode from links (UX B1a; also fixes today's share links):** `this.mode = fromLink ?
  fromLink.kind : loadMode()`. Test: saved Blocks mode + a `#code=` link shows the
  link's sketch.
- **`#class=`**: `takeHashPayload()` also recognises `#class=`. It removes the hash, and
  when configured calls `handinDialog.open(work, { joinCode })`.
- **Review mode** is active only when `location.hash === '#review'` **and**
  `self.origin === 'null'`, that is, in the sandbox.
  - Posts `{ type: 'z1-review-ready' }` to the parent and waits for the payload (§1.4).
  - Reads and writes no storage: no `saveCode`, `saveWorkspace`, `saveMode`, config or
    mute writes. It does not even try.
  - Takes the mode from the payload. Blocks come from `workspaceJson`, falling back to
    the code with the existing banner.
  - Hides New, Examples, Hand in, Share and Arduino IDE. Keeps Run, Stop, Reset,
    Settings and the Code/Blocks toggle.
  - Has no `hashchange` listener and never auto-runs.
  - A `#review…` hash **outside** a sandbox → `location.replace('./review.html' +
    location.hash)`, so a hand-in never runs on the site origin.
- `ExportedSketch` gains `workspace: object | null`. The Hand in click builds
  `HandinWork`:
  - `workspaceJson = JSON.stringify(workspace)`;
  - `unchanged`, from `isUntouchedText` / the last loaded example / `defaultBlocks`;
  - `errorCount`, from a synchronous `transpile(code)`.
- `openWork(content)` → `location.hash = handinHash(content).hash`. The existing
  `onHashChange` confirms and loads.
- **Update prompt** (`app_updated`):
  - `window.addEventListener('vite:preloadError', …)` and failed lazy imports (Blockly,
    the classroom chunk) first flush the editor and blocks autosave.
  - Then they show a banner: "The simulator was updated. Reload the page to continue
    (your work is saved)." with a **Reload** button.
- Keyboard guard: `onKeyDown` also returns while `handinDialog.isOpen()`.
- Share button title: "Share: copy the link or download an .ino file".
- `src/main.ts`: remove `z1.teacherEmail` and `z1.studentName` from localStorage once
  (in try/catch).

### 4.12 Share dialog and Arduino IDE dialog after the removal (B)

- **Share**:
  - title "Share your work";
  - intro "Share the link, or keep a copy for the Arduino IDE.";
  - Link + **Copy link**, **Download .ino**, status, **Close**;
  - when configured, one line: "To send your work to your teacher, use **Hand in**.";
  - always, a small line: "Teachers: see your students' work on the class dashboard
    (teacher.html)." (m3: the link moved out of the student dialog).
- Download names use `currentUsername()` (it was the typed name).
- `ShareDialogOptions` keeps `copyText`, `toast` and `download`, and drops `relayUrl`
  and `sendWork`.
- **Arduino IDE dialog**: the default `studentName()` becomes `currentUsername()`.

### 4.13 Teacher dashboard (C)

- **`teacher.html`** (repository root):
  - the same head as `index.html` (charset, viewport, `color-scheme: light`, favicon);
  - `<title>ZERO1 Classes – Teacher dashboard</title>` and `<meta name="robots"
    content="noindex">`;
  - `<div id="teacher"></div>` and `<script type="module" src="/src/teacher/main.ts">`.
- **`src/teacher/main.ts`**:
  - `import '../ui/style.css'; import './teacher.css';`;
  - then `mountDashboard(root, { configured: isClassroomConfigured(), loadApi: () =>
    import('../classroom/teacher').then((m) => m.createTeacherApi()) })`;
  - `loadApi` is called **at page load** when configured (F5).
- **`mountDashboard(root, options): Dashboard`**:
  - `DashboardOptions { configured; loadApi; download?(name, data: string | Blob);
    copyText?(text): Promise<void>; confirm?(text): boolean; now?: () => Date;
    storage?: Storage; tabStorage?: Storage }`;
  - `Dashboard { destroy(): void }` unsubscribes everything.
- **Views**: not-configured, loading, signed-out (T1), main (T2-T12).
  - Layout: a top bar, then either the class list or the class page at full width
    (m8). The Overview detail panel sits beside the table at 1200 px and above,
    otherwise below.
  - Reuse the tokens and `.z1-btn`, `.z1-dialog`, `.z1-setting` from `style.css`
    (import it; do not edit it). Dashboard classes use the prefix `z1t-` in
    `teacher.css`.
- **Live data**:
  - one `watchClasses` while signed in;
  - for the open class: `watchClass` and `watchTodayHandins` (when the period is
    Today), plus `watchMembers` while the Students tab or the overlay is visible.
  - Switching class keeps the previous class's listeners for **10 minutes** (at most
    one previous class). Re-subscribing with the memory cache re-bills every document.
- **Decoding**: the content of each loaded record is decoded (`decodeContent`) right
  after it arrives and cached by id in memory. Open links, `.ino` and Copy are enabled
  only once it is decoded, so there is **no `await` between a click and the action**
  (M3).
- **Open links**:
  - `reviewLink(payload)` gives the `href`;
  - when it returns a `handoff`, the dashboard writes it to `localStorage` **when it
    renders** the link (so middle-click works too) and removes its handoffs on
    `pagehide` and sign-out.
  - There is no "Opened in a new tab" toast.
- **Zip** (`src/teacher/zip.ts`):
  - `makeZip(files: { name: string; data: string | Uint8Array; date?: Date }[]): Blob`;
  - store-only (no compression), CRC-32, UTF-8 file names (flag bit 11);
  - names `<username>.ino`, `<username>.blocks.json`, `<username>-<yyyy-mm-dd-hhmm>.ino`
    for older versions, made unique with `sketchFileName` rules.
- **Allowed imports**: `src/classroom/model.ts`, `codec.ts`, `errors.ts`,
  `teacher.ts` (type imports plus the lazy import), `src/share-link.ts`,
  `src/ui/sketch-file.ts`. Anything that imports CodeMirror, Blockly, the transpiler or
  the runtime is not allowed.

### 4.14 Review page (C)

- **`review.html`**:
  - head as `teacher.html`, plus `<meta http-equiv="Content-Security-Policy"
    content="frame-src 'self'">` and `<meta name="robots" content="noindex">`;
  - `<script type="module" src="/src/review/main.ts">`.
- **`src/review/main.ts`**:
  1. Read `#review=` or `#rid=`, decode it with `decodeReviewPayload`, and drop handoffs
     older than 1 day.
  2. Render the banner and the buttons with `textContent`.
  3. Create `<iframe sandbox="allow-scripts" src="./index.html#review">`, sized to the
     rest of the window.
  4. Run the handshake of §1.4.
- The page imports only `src/share-link.ts`, `src/ui/sketch-file.ts` and its own CSS.

### 4.15 Vite multi-page build and GitHub Pages (C)

```ts
// vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Vite's default dev CORS (local origins only) plus 'null': the sandboxed review frame
// (opaque origin) loads the simulator's module scripts with Origin: null. GitHub Pages
// already serves every file with Access-Control-Allow-Origin: *.
const LOCAL_ORIGIN = /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  base: './',
  server: { cors: { origin: [LOCAL_ORIGIN, 'null'] } },
  preview: { cors: { origin: [LOCAL_ORIGIN, 'null'] } },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: { input: { main: page('./index.html'), teacher: page('./teacher.html'), review: page('./review.html') } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- `npm run build` emits `dist/index.html`, `dist/teacher.html`, `dist/review.html`, and
  shared hashed chunks with relative URLs.
- The existing workflow uploads `dist/`. Pages serves `…/zero1smartboard/teacher.html`
  and `review.html`.
- Links between the pages are relative (`./teacher.html`, `./review.html`, `./`).
- The review sandbox depends on the `Access-Control-Allow-Origin: *` header of GitHub
  Pages. Moving the site to another host requires the same header for `/assets/*`.
  Without it the frame stays blank (verified).

### 4.16 Local development with emulators (A)

- `.env.emulator` contains `VITE_CLASSROOM_EMULATOR=1`.
- Terminal 1: `npm run emulators` (= `npx --yes firebase-tools@15.31.0
  emulators:start --only auth,firestore --project demo-zero1`; needs Java 21).
- Terminal 2: `npm run dev:emulator` (= `vite --mode emulator`).
- The auth emulator shows a fake Google account chooser.
- Emulator mode is never active in `npm run build`.

---

## 5. Config: `src/firebase-config.ts` (A)

```ts
/**
 * Public web config of the Firebase project behind the class platform (docs/CLASSROOM.md §6.1).
 * Where to find it: Firebase console → Project settings → General → Your apps → the Web app → Config.
 * These values are not secret: they identify the project; firestore.rules control access.
 * While apiKey, authDomain, projectId and appId are empty:
 * - the simulator has no Hand in button and never downloads Firebase;
 * - teacher.html says "not set up yet".
 */
export interface FirebaseWebConfig {
  apiKey: string; authDomain: string; projectId: string; appId: string;
  storageBucket?: string; messagingSenderId?: string; measurementId?: string;  // accepted (paste the snippet whole), unused
}
export const FIREBASE_CONFIG: FirebaseWebConfig = { apiKey: '', authDomain: '', projectId: '', appId: '' };

/** reCAPTCHA Enterprise site key for App Check (§3.6, step 9). Empty = App Check off. */
export const APP_CHECK_SITE_KEY = '';

/** Deployment defaults the maintainer may tune (§6.2). */
export const CLASSROOM_DEFAULTS = {
  /** Default "Keep hand-ins for" of new classes, in weeks (1-52). */
  keepWeeks: 10,
} as const;
```

- Not-configured behaviour: §1.1.
- Tests:
  - `isClassroomConfigured()` is false for the committed file. A test pins it, so a
    half-filled config is noticed: all four set, or none.
  - It is true for a complete object and in emulator mode.
  - `CLASSROOM_DEFAULTS.keepWeeks` is in 1-52.

---

## 6. Setup guide (maintainer) and capacity

### 6.1 Maintainer setup (once, about 30 minutes)

Firebase's console moves things around. The names below are from September 2026 (see
Appendix A).

1. **Create the project.**
   - console.firebase.google.com → Add project → name, e.g. `zero1-classes`.
   - **Turn Google Analytics off.**
   - The project starts on the free Spark plan; do not add billing yet.
2. **Register a web app.**
   - Project overview → `</>` → nickname "ZERO1 simulator".
   - Do **not** tick Firebase Hosting. Keep the config snippet.
3. **Authentication** → Get started → Sign-in method:
   - Enable **Google**: public-facing name "ZERO1 Classes", support email.
   - Enable **Anonymous**.
   - Do **not** upgrade to "Firebase Authentication with Identity Platform". Its
     automatic clean-up deletes anonymous accounts 30 days after creation, which would
     force every student to re-join monthly and lose their "My hand-ins" history. (With
     clean-up, anonymous users no longer count toward its usage limits, so the 3,000
     daily-active-user cap is not the issue.)
4. **Google Auth Platform** (Google Cloud console for the same project) → Branding and
   Audience:
   - User type **External**; publishing status **In production**. In "Testing", only
     listed test users can sign in.
   - Keep the default scopes (email, profile, openid) and no logo, so no verification
     review is needed.
5. **Authentication → Settings → Authorized domains** → add `ebechalani.github.io`.
   - `<project-id>.firebaseapp.com` is listed by default; the sign-in popup runs there.
   - Projects created after 2025-04-28 no longer list `localhost`. Add it only if
     developers sign in against the **real** project locally; the emulators need nothing.
6. **Firestore Database** → Create database:
   - edition **Standard**;
   - location **`europe-west1`** (Belgium, regional; recommended) or `eur3` (EU
     multi-region). **This cannot be changed later.** On Blaze, regional costs about
     half as much.
   - start in **production mode**.
7. **Publish rules and indexes (mandatory).**
   - `npx firebase-tools@15.31.0 login`, then `npx firebase-tools@15.31.0 deploy --only
     firestore:rules,firestore:indexes --project <project-id>`.
   - The composite indexes take a few minutes to build.
   - From now on, publish **before** merging a client change that depends on new rules
     or indexes.
8. **Sign-up quota.** Authentication → Settings → user actions / sign-up quota:
   **schedule a temporary increase** of the per-IP limit (100 an hour) for the launch
   week and the first week of each term. A school with 4+ classes behind one public IP
   (or a carrier-grade NAT) exceeds it when labs wipe browser data. Permanent changes go
   through support.
9. **App Check** (recommended; §3.6).
   - Google Cloud → reCAPTCHA → create a **score-based** web key for
     `ebechalani.github.io` (and `localhost` for development against the real project).
   - Firebase → App Check → register the web app with the **reCAPTCHA Enterprise**
     provider, token lifetime **7 days**.
   - Paste the site key into `APP_CHECK_SITE_KEY`.
   - Leave Firestore and Authentication in **monitoring** mode. Enforce per §3.6.
10. **Paste the web config** into `src/firebase-config.ts` (apiKey, authDomain,
    projectId, appId). Set `CLASSROOM_DEFAULTS.keepWeeks` (§6.2). Commit, push to
    `main`; the Pages workflow deploys. **Deploy outside school hours**: tabs opened
    before a deploy show the "simulator was updated" prompt.
11. **Smoke test** (production only; the emulator does not check indexes):
    1. Open `…/teacher.html`, sign in, create a class with two usernames and one task.
    2. In a private window, open the class link, pick a name and hand in. The hand-in
       appears on the Overview.
    3. **Open** runs it in `review.html`. Download .ino works.
    4. Open **My hand-ins** (composite index 1). Open the student's detail and **Load
       older versions** (composite index 2).
    5. Stop hand-ins; the student sees `handins_closed`.
12. **Afterwards**: §6.3. Tell school IT to allow `firestore.googleapis.com`,
    `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
    `<project-id>.firebaseapp.com`, `apis.google.com`, `accounts.google.com` (and
    `www.google.com/recaptcha`, `www.gstatic.com`, `firebaseappcheck.googleapis.com`
    when App Check is on).
13. **Google Workspace schools**: if a teacher's Google account is managed by the
    school, the admin may have to allow the app (Admin console → Security → API controls
    → App access control), or the teacher uses another Google account.

### 6.2 Free-plan capacity

**Spark limits** (Firestore, per project, per day unless stated):
- 50,000 reads, 20,000 writes, 20,000 deletes;
- 1 GiB stored, 10 GiB outbound per month;
- reset around midnight US Pacific time (09:00 CET / 10:00 Beirut, during the school day).

**Auth limits**: no monthly-active-user cap without Identity Platform; 100 new
anonymous accounts per hour per IP; 100 M anonymous accounts in total.

**Stored size per hand-in**: about **2.5 KB**.
- Document: about 0.3 KB of metadata, about 1.1 KB of gzip sketch (examples: 2,356 B
  raw → 1,067 B gzip), and about 0.5 KB of gzip workspace on half of the hand-ins.
- Index entries: `createdAt` asc/desc plus 2 composites, about 0.5 KB.
- The draft measured about 8.3 KB (Feasibility 1).

**Cost per class-lesson** (30 students, 45 hand-ins). Assumptions: the dashboard stays
open in one tab and is loaded twice; the Students tab is opened once; the teacher marks
later with a 7-day view.

| part | reads | writes | deletes |
|---|---|---|---|
| students: 30 dialog opens (restore) | 30 | | |
| students: 45 hand-ins (rule reads ≤ 3 each) | 135 | 90 | |
| students: 10 "My hand-ins" opens (≈ 5 docs each) | 50 | | |
| teacher: 2 loads (5 classes + class + today's hand-ins so far + rule get) | ≈ 55 | | |
| teacher: 45 live hand-ins into the open listener | 45 | | |
| teacher: Students tab (≈ 35 members + rule get) | ≈ 36 | | |
| teacher: marking later, 7-day view (≈ 90 hand-ins + rule get) | ≈ 91 | | |
| teacher: retention (2 counts + steady-state prune of ≈ 45) | ≈ 47 | | ≈ 45 |
| **total** | **≈ 490** | **≈ 90** | **≈ 45** |
| extra where lab PCs wipe browser data (30 re-joins × 3 reads, 1 write) | +90 | +30 | |

**Ceiling.**
- Reads are the bottleneck. At a safe 80 % of the quota (40,000 reads) the plan carries
  **≈ 80 class-lessons a day**, or ≈ 70 with wiped labs.
- That is **about 35-40 schools** of the profile used in the review (5 classes × 2
  lessons a week, so 2 class-lessons per school-day).
- The full 50-school scenario (100 class-lessons a day, ≈ 49,000-58,000 reads) is
  **over Spark**. Beyond about 35 schools, move to Blaze (§6.3).
- Writes (≈ 12,000 a day at 100 class-lessons) and deletes are not limiting.

**Storage.**
- At 4,500 hand-ins a day: ≈ 11 MB a day, so 1 GiB is full in ≈ 95 school days without
  retention.
- With `keepWeeks = 10` (≈ 50 school days) the steady state is ≈ 560 MB, plus members
  and classes.
- Small deployments (≤ 10 schools) can set `CLASSROOM_DEFAULTS.keepWeeks = 40` (a school
  year).
- Year-end cleanup is no longer needed: retention deletes continuously, within the
  daily delete quota.

**Outbound traffic**: about 2-3 KB per listed hand-in, so tens of MB a day, far below
10 GiB a month.

**Cost of the teacher's memory cache (D12).** Every reload or reconnect re-reads the
open views in full. Firestore bills only the changes on a resumed listener when offline
persistence is on, and that is not used here, for privacy on shared teacher PCs. This
is included in the table above (2 loads per lesson).

### 6.3 Monitoring and escalation (maintainer)

- **Weekly**: Firestore → Usage (reads, writes, deletes, storage), Authentication →
  Usage, and App Check metrics.
- **Escalate** when any quota is above **70 % on 3 days** in a week, or on the first
  `quota` report from a school:
  1. enable **Blaze** with a **budget alert**, for example $5 a month (at this scale the
     overage costs cents per 100,000 operations);
  2. then consider App Check enforcement (billing removes the 10,000-assessment
     ceiling).
  - Alternatively, stop onboarding new schools.
- **Abuse**: runbook §3.6.
- **Yearly** (August): in the console, find classes whose `updatedAt` is older than 12
  months, write to their teachers, and delete them (the teacher's own dashboard also
  offers deletion).

---

## 7. Test plan

### 7.1 Security rules (A): `tests-emulator/firestore.rules.test.ts`

Copy `scratchpad/classroom-design/final/rules/tests/rules.test.ts` (78 tests, all
passing) and adapt the path (`readFileSync('firestore.rules')` from the repository root).

**Setup.**
- `initializeTestEnvironment({ projectId: 'demo-zero1', firestore: { rules, host:
  '127.0.0.1', port: 8080 } })`.
- Contexts:
  - `teacher(uid)` = `authenticatedContext(uid, { firebase: { sign_in_provider:
    'google.com' }, email, email_verified: true })`;
  - `student(uid)`: `sign_in_provider: 'anonymous'`;
  - `nobody()`.
- Seed with `withSecurityRulesDisabled`; `clearFirestore()` before each test.

**Cases**, by group:
- **R1 classes, create.**
  - R1.1 happy path.
  - R1.2 teacher gate: anonymous, unverified, **no `email_verified` claim**,
    password/custom/phone/facebook, smuggled claims, signed out → all ✗.
  - R1.3 foreign ownerUid ✗.
  - R1.4 codes `BKT4M`, `BKT4M9X`, `bkt4m9`, vowel, `0 1 2 5 6 8 Y` ✗.
  - R1.5 extra or missing field, client times, `deleting: true`, schema 2, rejoin at
    create, client join window ✗; server window ✓.
  - R1.6 name lengths.
  - R1.7 re-create over an existing class ✗.
- **R2 validation.**
  - R2.1 roster 0 / 100 ✓, 101 ✗.
  - R2.2 bad usernames ✗.
  - R2.3 2- and 24-char names ✓; duplicates, bad ids, non-strings, arrays ✗.
  - R2.4 tasks: 30 ✓ (any language), 31 ✗, bad id ✗, empty or 61-char title ✗,
    missing `currentTaskId` ✗.
  - R2.5 `keepWeeks` 0 / 53 / 10.5 / "10" ✗, 52 ✓.
  - R2.6 `join()` coercion documented.
- **R3 classes, read / update / delete.**
  - R3.1 get by code (also a missing one) ✓, signed out ✗.
  - R3.2 the class GET exposes `ownerUid` and the roster, no email (documented).
  - R3.3 list own with the filter only.
  - R3.4 the owner edits every mutable field ✓.
  - R3.5 immutable fields, extra fields, missing `updatedAt` ✗.
  - R3.6 join window: server time ✓, client time ✗, null ✓.
  - R3.7 rejoin: roster keys only; removing a student requires removing their rejoin
    entry.
  - R3.8 deleting a task requires clearing `currentTaskId`.
  - R3.9 field-path roster edits; duplicate ✗.
  - R3.10 other teachers and students cannot update or delete; the owner deletes.
  - R3.11 deleting a missing class: teacher ✓, student ✗.
- **R4 members, join.**
  - R4.1 happy path.
  - R4.2 closed ✗, window ✓, expired window ✗.
  - R4.3 rejoin for that student only, 15 minutes.
  - R4.4 hand-ins stopped / deleting / missing class ✗.
  - R4.5 wrong name, unknown id, other uid ✗.
  - R4.6 forged fields ✗.
  - R4.7 HTML in the device label is stored (rendering test in §7.3).
  - R4.8 re-bind ✗; a tick without a hand-in ✗.
  - R4.9 a tick against an **old** own hand-in ✗.
- **R5 members, read / remove.**
  - R5.1 own only.
  - R5.2 the owner lists (bounded, by studentId) and deletes; others ✗.
  - R5.3 a double delete batch ✓.
- **R6 hand-ins, create.**
  - R6.1 batch with `increment(1)` ✓.
  - R6.2 plain blocks, gzip code, gzip blocks ✓.
  - R6.3 encoding and type mismatches ✗.
  - R6.4 `increment(2)`, `increment(0)`, no tick, tick id mismatch ✗.
  - R6.5 not joined, other studentId, other class, a teacher ✗.
  - R6.6 forged fields ✗.
  - R6.7 bad id ✗.
  - R6.8 sizes: 50,000 ✓ / 50,001 ✗, `é` × 25,001 ✗, workspace 100,001 ✗, gzip 50,001
    bytes ✗, title 81 ✗, note 501 ✗, empty code ✗, 80 + 500 ✓.
  - R6.9 kind vs workspace.
  - R6.10 cooldown.
  - R6.11 cap of 300.
  - R6.12 removed ✗; renamed: old ✗, new ✓.
  - R6.13 task.
  - R6.14 closed joining still ✓; stopped or deleting ✗.
  - R6.15 join + tick + hand-in in one batch ✗.
  - R6.16 a retry with the same id after success ✗, and the member doc shows the id.
- **R7 hand-ins, read / re-file / delete / prune.**
  - R7.1 the student query by uid ✓; others' docs ✗.
  - R7.2 students cannot edit, re-file or delete.
  - R7.3 owner list / window / per student / `count()` / get.
  - R7.4 another teacher ✗.
  - R7.5 collection-group queries ✗.
  - R7.6 re-file: roster-consistent ✓, anything else ✗, task ✓ / unknown ✗.
  - R7.7 double delete ✓.
  - R7.8 prune query and batch.
- **R8.**
  - R8.1 delete-class flow (61 deletes in one batch, no rule reads).
  - R8.2 unknown collections and the old `handinCode` ✗.

**Mutation check.** Run in CI monthly or when the rules change:
`tests-emulator/mutations.sh` re-runs the suite against each rule mutation of App. B.
Each mutation must make at least one test fail.

**Sync test.** `tests/classroom-model.test.ts` reads `firestore.rules` as text and
asserts that:
- every number in `LIMITS` that the rules use appears in it: 60, 100, 30, 24, 80, 500,
  40, 50000, 100000, 300, 10 s, 15 m, 52;
- the code alphabet regex appears in it.

### 7.2 Data layer (A)

**Unit** (node, the normal `npm test`):
- `tests/classroom-model.test.ts`:
  - `normalizeClassCode`: case, spaces, hyphens, dots, `2 5 6 8` mapping, vowels and
    `0`/`1` → null;
  - `codeProblem` texts;
  - `formatClassCode`, `classLink`;
  - `generateClassCode`: alphabet only, length, uniform over 24,000 draws within ±15 %
    per symbol; rejection of bytes ≥ 240 with a scripted source;
  - `newStudentId`, `newTaskId`, `newHandinId` (20 × `[A-Za-z0-9]`);
  - `normalizeUsername` table, with and without `shortenLastName`:
    - `Ali Khalil` → `ali.khalil` / `ali.k`;
    - `Élise Martin` → `elise.martin` / `elise.m`;
    - `  sara__m ` → `sara_m`;
    - `O'Neil` → `oneil`;
    - Arabic only → `''`;
  - `nearDuplicates`;
  - `planRosterAdd`: split rules, duplicates, already in class, more than 100,
    collisions after shortening, warnings;
  - `planTasksAdd`, `sortedRoster`, `sortedTasks`;
  - `joinStatus`: open, window inside and outside, rejoin for this and another student,
    ±skew;
  - `cleanLine` / `cleanMultiline` (the tests moved from share-dialog);
  - `utf8Length`;
  - `deviceLabel` table: Chrome, Edge, Firefox and Safari on Windows, macOS, ChromeOS,
    Android, iOS and Linux, plus unknown;
  - `draftProblem`;
  - the limits-in-rules sync test.
- `tests/classroom-codec.test.ts` (node 22 has `CompressionStream`):
  - round trip plain and gzip;
  - a tiny sketch stays plain (gzip is not smaller);
  - `compress: false`;
  - decode cap (a 5 MB bomb → `too_large`);
  - corrupt bytes → `corrupt`;
  - missing `DecompressionStream` (stubbed) → `unsupported`;
  - a code-kind workspace encodes to empty bytes.
- `tests/classroom-errors.test.ts`:
  - `toClassroomError` for every Firebase code in §1.5 (plain objects `{ code, name:
    'FirebaseError' }`), including `failed-precondition` → `index_missing`;
  - a failed `import()` → `load_failed`, or `app_updated` when flagged;
  - anything else → `unknown`;
  - `withTimeout` with fake timers;
  - both text tables cover every code;
  - `errorText` placeholders;
  - `quotaResetText` with fixed dates in the Europe/Paris and Asia/Beirut time zones,
    across DST changes.
- `tests/classroom-session-store.test.ts`: round trip, bad JSON, wrong version, storage
  that throws, tab flag, `currentUsername`.
- `tests/classroom-student-unit.test.ts`, with a fake `load` spy:
  - `restore()` with nothing saved resolves null **without calling load**;
  - the `confirm` reasons (`new_tab` / `stale` / null);
  - the `diagnoseHandinRefusal` table (every branch, including `arrived`);
  - `handIn` rejects `empty_sketch` / `too_large` / `too_soon` without calling load;
  - a timeout followed by a member read with the same id → success;
  - `myHandins` maps `failed-precondition` → `index_missing` (no fallback query).
- `tests/share-link.test.ts`:
  - the moved share-link tests;
  - `classFromHash`;
  - `encodeReviewPayload` / `decodeReviewPayload`: round trip, strict shape, bad input;
  - `reviewLink`: under and over 60,000 characters;
  - `handinHash`: code, blocks, invalid workspace → fallback.
- `tests/bundle-boundary.test.ts` (§4.2): a source scan of static imports.

**Integration** (emulators, `npm run test:emulator`), in `tests-emulator/`:
- `student-api.test.ts`: the real `createStudentApi({ load })` with a loader wired to
  the emulators and in-memory storages.
  - findClass: bad code, missing, stopped, open.
  - join: open, closed → `class_closed`, window, rejoin.
  - continueAs.
  - restore: same uid, changed uid → `lost_identity`, class deleted, not on roster,
    stopped, rename refreshes.
  - handIn:
    - success, both encodings;
    - cooldown → `too_soon`;
    - removed → `not_on_roster`;
    - renamed → automatic retry with the same id succeeds;
    - limit via a seeded counter → `limit_reached`;
    - **a committed batch followed by `handIn` with the same id → success, no duplicate**.
  - myHandins paging.
  - leave → a new uid that sees nothing.
- `teacher-api.test.ts`: sign in with
  `signInWithCredential(GoogleAuthProvider.credential(JSON.stringify({ sub, email,
  email_verified: true })))`. `signIn()` itself is covered by the UI tests with a fake.
  - createClass, including a collision: pre-seed the first generated code with a
    scripted `randomBytes`.
  - watchClasses.
  - openJoinWindow / closeJoining / letRejoin.
  - add / rename / remove students (members removed too).
  - tasks: add, rename, delete (clears current).
  - watchMembers, removeDevice, removeUnusedDevices.
  - watchTodayHandins (`added` when a student hands in; `modified` after a re-file).
  - loadHandins paging, studentHandins, refileHandin, deleteHandin.
  - countHandinsBefore, pruneHandins with 450 seeded old hand-ins (cap respected).
  - deleteClass with 900 seeded docs: at least 3 batches, progress callbacks, a budget
    of 500 → `'more'`, then Finish → `'done'`.
  - deleteAllClasses; deleteAccount (with `classes_left` first).
- `flow.test.ts`: the e2e of App. B (two named apps in one process).

### 7.3 UI (happy-dom)

**B**:
- `tests/handin-dialog.test.ts`, with a fake `StudentApi` (in memory; each method a
  `vi.fn`):
  - not configured: no `data-slot="handin"`;
  - no saved session → Code view focused;
  - invalid code → inline error with the `codeProblem` detail and no API call;
  - `class_not_found`;
  - Pick:
    - sorted list;
    - filter above 12 names;
    - Refresh the list;
    - empty roster text;
    - closed joining detected locally (no `join` call);
  - This is me → `join(cls, id)` → Ready "Hand in as ali.k";
  - already joined → Continue / Sign out;
  - `#class=` join mode: same class → Confirm; other class → Switch; end text;
  - Confirm view:
    - shown for `new_tab` and `stale`;
    - Yes → `confirm`;
    - someone else / Different class → `leave` with the right `forgetCode`;
    - My hand-ins hidden until confirmed;
  - empty, too large and offline → no API call;
  - unchanged example → a second click is needed; `errorCount` note;
  - task select preselects `currentTaskId`;
  - success view (title kept, note cleared), **double click → one `handIn`**;
  - timeout → "Checking…" → success when the fake reports `arrived`;
  - Try again reuses the **same `handinId`**;
  - every error code → its §1.5 text (table-driven);
  - `not_on_roster` / `device_removed` / `lost_identity` buttons;
  - history: lazy on open, Show more, empty text, Open → `openWork` and the dialog
    closes;
  - Esc closes; the App keyboard guard works while open;
  - `onSessionChange` updates the header label.
- `tests/app-header.test.ts`:
  - the button exists only when configured (mock `isClassroomConfigured`);
  - order: New … Settings, Hand in, Share, Arduino IDE;
  - label "Hand in · ali.k" from a saved session;
  - Share title;
  - Blocks mode passes `workspaceJson`;
  - **saved Blocks mode + a `#code=` link shows the link's sketch** (B1a).
- `tests/app-review-mode.test.ts`: with `self.origin` stubbed to `'null'` and a
  `localStorage` spy:
  - no storage access at all;
  - mode from the payload;
  - hidden buttons;
  - the ready/payload handshake with source and origin checks;
  - messages from a wrong source or origin are ignored;
  - no auto-run;
  - `#review=` with a normal origin → `location.replace('./review.html#review=…')`.
- `tests/share-dialog.test.ts`:
  - no email, name or message inputs and no Send button;
  - Copy link and Download .ino unchanged;
  - the Hand in hint only when configured;
  - the teachers line;
  - download name from `currentUsername()`.
- `tests/codegen.test.ts`: the X1 cases (§3.4).

**C**:
- `tests/teacher-dashboard.test.ts`, with `tests/fakes/fake-teacher-api.ts` (an
  in-memory store with callbacks, `emit*` helpers, and a `ready` deferred):
  - not configured: `loadApi` is never called;
  - signed out:
    - the button is disabled until `ready`;
    - **`signIn` is called synchronously in the click** (the fake records that no
      microtask passed);
    - `popup_blocked` text; `popup_closed` silent;
  - class list and empty state;
  - create class:
    - name required;
    - preview of normalised and shortened names, problems and near-duplicate warnings;
    - Create disabled when there are problems;
    - tasks;
    - the code shown formatted;
  - class page:
    - Copy code and Copy class link;
    - overlay (joined count, Esc);
    - joining control: switch, 15-minute window countdown (fake clock), +15, Close now;
    - hand-ins switch; current task;
  - Overview:
    - one row per roster student, "Nothing yet";
    - "22 of 28";
    - New / Seen persisted in storage;
    - a live insert, with one polite announcement;
    - period switch: Today live → 7 days one-off, remembered per class;
    - task filter;
    - "2 computers within an hour" only for close hand-ins;
    - **the Open link is an `<a target=_blank rel="noopener noreferrer">` pointing at
      `./review.html#review=…`, and `#rid=` + handoff when large**;
    - `.ino` enabled after decode, with no await between the click and `download`;
    - zip downloads;
  - detail:
    - versions, Load older;
    - Move to student / task → `refileHandin`;
    - Remove the computer; Delete;
    - decode problems → texts;
  - All hand-ins: "(removed) name";
  - Students:
    - add with preview; rename with duplicate error;
    - remove (members too);
    - Let join again;
    - device list and removal;
    - Remove unused;
    - the members listener only while visible;
  - retention: warning line + download, prune toast, once per tab;
  - delete class:
    - the confirm input accepts `bkt-4m9`;
    - progress; `'more'` → Finish deleting;
  - T12, two steps: `deleteAccount` called synchronously;
  - sign out: 0 active listeners and handoffs cleared;
  - listener error banner + Retry;
  - class switch keeps the previous listeners (fake clock: 10 min).
- **textContent matrix** (Security m4), in both `teacher-dashboard.test.ts` and
  `handin-dialog.test.ts`:
  - payloads `<img src=x onerror=alert(1)>` and `</script><b>x</b>`;
  - in `username`, `device`, `title`, `note`, `teacherName`, class `name`, task title
    and code;
  - rendered on Overview, detail, All hand-ins, Students, the overlay, the review banner
    (`review-page.test.ts`) and the student Pick / Ready / history / Confirm views;
  - assertion: no `img` / `b` element is created and the text is shown literally.
- `tests/review-page.test.ts`:
  - payload from the hash and from a handoff;
  - expired handoff and broken payload texts;
  - the iframe has **exactly** `sandbox="allow-scripts"` and `src="./index.html#review"`;
  - the CSP meta is present;
  - handshake: replies only to the frame's `z1-review-ready` with origin `'null'`;
  - Download .ino and Copy from the payload.
- `tests/zip.test.ts`:
  - CRC-32 of known strings;
  - a 2-file zip parsed back by a minimal reader in the test (local headers + central
    directory);
  - UTF-8 name flag.

### 7.4 Browser check of the sandbox (manual, plus an optional script)

`scratchpad/classroom-design/final/sandbox/probe*.mjs` show the method: Playwright with
Chromium against a static server that sends `Access-Control-Allow-Origin: *`. Before
each release that touches the review page, a developer runs the equivalent against
`vite preview` (the cors config of §4.15 applies there) and checks:

1. The simulator loads in the frame. Run works. Blocks switch works.
2. The PoC sketch (`Serial.constructor.constructor(...)`) either fails to compile (X1)
   or, when X1 is disabled for the check, throws `SecurityError` for `localStorage`,
   `parent.localStorage` and `indexedDB`.
3. The frame cannot navigate to another site (CSP).

### 7.5 Build checks (A)

`scripts/check-bundle.mjs`, run in CI after `vite build`, reads `dist/.vite/manifest.json`
(enable `build.manifest`). It fails when:
- the `index.html` entry chunk or any of its **static** imports contains
  `firestore.googleapis.com`, `identitytoolkit` or `initializeApp(`;
- the chunks reachable from `student-sdk` exceed **70 KB gzip**;
- those from `teacher-sdk` exceed **200 KB gzip**;
- `review.html`'s chunks contain any Firebase code.

### 7.6 npm scripts and CI (A)

```json
{
  "scripts": {
    "build": "tsc --noEmit && vite build && node scripts/check-bundle.mjs",
    "test": "vitest run",
    "test:emulator": "npx --yes firebase-tools@15.31.0 emulators:exec --only auth,firestore --project demo-zero1 \"npx vitest run --config vitest.emulator.config.ts\"",
    "emulators": "npx --yes firebase-tools@15.31.0 emulators:start --only auth,firestore --project demo-zero1",
    "dev:emulator": "vite --mode emulator"
  },
  "dependencies": { "firebase": "^12.19.0" },
  "devDependencies": { "@firebase/rules-unit-testing": "^5.0.2" }
}
```

- **firebase-tools** is not a devDependency: it is 271 MB, and `npm ci` of the Pages
  build would slow down. `firebase` is pinned at `^12.19.0`, which contains the iPad
  Safari popup fix (#10318 / PR #10325).
- **`firebase.json`**:
  ```json
  { "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
    "emulators": { "auth": { "host": "127.0.0.1", "port": 9099 }, "firestore": { "host": "127.0.0.1", "port": 8080 }, "ui": { "enabled": false }, "singleProjectMode": true } }
  ```
- **`vitest.emulator.config.ts`**: `include: ['tests-emulator/**/*.test.ts']`,
  `testTimeout: 30000`, `hookTimeout: 30000`, `fileParallelism: false`. Java 21 is
  required: firebase-tools 15.31 refuses older versions.
- **`.github/workflows/deploy.yml`** (push to `main`):
  - `build` (npm ci, npm test, npm run build) and `emulator-tests` run in parallel;
  - `deploy` has `needs: [build, emulator-tests]`;
  - keep `concurrency: pages` for this workflow only.
- **`.github/workflows/ci.yml`** (`pull_request`): the same `build` and
  `emulator-tests` jobs, no deploy, with `concurrency: ci-${{ github.ref }}` and
  `cancel-in-progress: true`. A pull request can never cancel a Pages deploy.
- **`emulator-tests` job**:
  - `actions/setup-java@v4` (temurin 21);
  - `actions/cache@v4` for `~/.cache/firebase/emulators`, key
    `firebase-emulators-15.31.0`;
  - a separate `actions/cache@v4` for `~/.npm/_npx`, key `npx-firebase-tools-15.31.0`.
    The shared `setup-node` npm cache is saved by `build` first and would never contain
    the npx download.
- **Optional `deploy-rules` job**, when the secret `FIREBASE_SERVICE_ACCOUNT` exists:
  `firebase deploy --only firestore:rules,firestore:indexes` after the tests on `main`.
  Without it, §6.1 step 7 applies (publish before merging).

### 7.7 Manual acceptance (before announcing)

On the real project:
- Browsers: Chrome, Edge, Firefox, Safari (macOS and **iPad**, including teacher
  sign-in and a reload), a Chromebook in guest mode (re-join via **Let join again**).
- The full S0-S7, T1-T12 and review flows.
- Two teachers cannot see each other's classes.
- A student on computer 2 does not see computer 1's history.
- Header layout at 1366 px while joined.
- The review sandbox check (§7.4) on the deployed site.
- After one simulated lesson, the Usage page matches §6.2 within about 30 %.
- App Check metrics show "verified" requests.

---

## 8. Removal of the email relay (B, after the current review-fix pass lands)

The names below are as of commit a705e3c. Re-check them after the review-fix pass.

**Delete:**
- `tools/email-relay/Code.gs` and the `tools/email-relay/` folder (and `tools/` if it
  is empty);
- `docs/EMAIL.md`;
- `tests/email-relay.test.ts`;
- `src/config.ts` (it only holds `EMAIL_RELAY_URL`).

**Edit:**
- `src/ui/share-dialog.ts`:
  - Remove the "Send to your teacher" section and its handlers, and the options
    `relayUrl` / `sendWork`.
  - Remove the exports and constants `TEACHER_EMAIL_STORAGE_KEY`,
    `STUDENT_NAME_STORAGE_KEY`, `NAME_MAX_LENGTH`, `MESSAGE_MAX_LENGTH`,
    `EMAIL_PATTERN`, `EMAIL_MAX_LENGTH`, `isValidEmail`, `cleanEmail`,
    `SendWorkRequest`, `RELAY_ERRORS`, `SendWorkError`, `SendWorkResult`,
    `sendWorkToTeacher`, `readRelayAnswer`, `NOT_SET_UP`, `OFFLINE`,
    `SEND_ERROR_TEXT`, `loadText`, `saveText`.
  - Remove `CODE_MAX_LENGTH` unless Copy link uses it.
  - `cleanName` / `cleanMessage` / `cutAt` / `INVISIBLE*` move to `model.ts` as
    `cleanLine` / `cleanMultiline` (A).
  - Keep `LINK_MAX_LENGTH` if the Copy link warning uses it.
  - Update the header comment.
  - Keep Copy link, Download .ino, status and Close. Add the lines of §4.12.
- `src/ui/arduino-ide-dialog.ts`: import `currentUsername` instead of
  `STUDENT_NAME_STORAGE_KEY`.
- `src/ui/style.css`:
  - remove every rule that only the send section used: `.z1-share input[type='email']`,
    `.z1-share textarea`, `.z1-share-fields`, `.z1-share-send*`, `.z1-share-off`,
    `.z1-share-error`, … (grep the dialog template afterwards);
  - add `.z1-handin*`, `.z1-handin-name` and the short-brand breakpoint.
- `src/ui/app.ts`: the Share title and comment (§4.11).
- `src/main.ts`: one-time removal of `z1.teacherEmail` and `z1.studentName`.
- Tests:
  - `tests/share-dialog.test.ts`: drop the relay, email, name and message tests; keep
    and adapt the link, copy and download tests.
  - `tests/app-header.test.ts` and `tests/arduino-ide-dialog.test.ts`: names from
    `currentUsername()`.
- `README.md`:
  - Replace the Share bullet with: **Share**: copy a link to the work or download it as
    an `.ino` file.
  - Add **Classes**: "Teachers create a class on the teacher page and share the class
    code or link. Students press *Hand in*, pick their name and hand in their sketch or
    blocks. The teacher sees who handed in, runs each hand-in safely in the simulator
    and downloads the `.ino`. See docs/CLASSROOM.md (set up once by the site
    maintainer, free Firebase plan)."
  - Add `teacher.html` / `review.html` to "Running it locally", and
    `npm run test:emulator` to the commands.
- `docs/ARCHITECTURE.md`:
  - §8.1: header diagram with Hand in and the short brand;
  - §8.3: the Share paragraph rewritten, a new Hand in paragraph, review mode;
  - §2: layout (classroom, teacher and review folders);
  - links to §12 / §13 (A/C).

**Final check**, which must print nothing:
`grep -rn "EMAIL_RELAY\|email-relay\|EMAIL\.md\|sendWorkToTeacher\|z1\.teacherEmail\|Send to teacher\|recipient_not_allowed" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git .`

The one-time clean-up line in `main.ts` names the legacy keys: write them as
`'z1.' + 'teacherEmail'`. Teachers who deployed the relay can delete their Apps Script
project (script.google.com); the release notes say so.

---

## 9. Privacy notes

**Personal data stored.**
- **Teachers**:
  - Google account uid, email, display name and photo URL, in Firebase Authentication
    only (not copied to Firestore);
  - `teacherName` (free text, shown to anyone with the code);
  - class and task names;
  - the Firebase `ownerUid` (an opaque id), visible to code-holders (§3.5).
- **Students**: **no account data**. Anonymous Firebase users have only a uid and
  timestamps.
  - The roster usernames are chosen by the teacher and visible to anyone with the class
    code. The default **shortens last names to an initial** (`ali.k`). Recommend
    pseudonymous handles, never full names.
  - Hand-ins hold the code, blocks, task, title, note (free text a student could fill
    with personal data), time, the username at hand-in, the device uid, and a coarse
    device label ("Chrome · Windows"). No IP and no fingerprint are stored.
  - Google processes IP addresses for abuse protection: the per-IP sign-up limit, and
    reCAPTCHA when App Check is on. The app stores none.

**Minors.**
- No email, password, name or analytics is collected from students. There is no Google
  Analytics (step 1) and no tracking.
- reCAPTCHA (App Check) runs a Google risk check in the browser. When it is enabled,
  say so in the schools' notice.
- The school or teacher decides the usernames, and is the one who can see and delete
  the work.
- Schools using the deployment should mention it in their privacy notice. Firebase is a
  Google Cloud service under the Firebase / Google Cloud data processing terms; the
  maintainer is the project owner.

**Who can see what.**
- A teacher sees only their own classes.
- A student sees the class name, teacher name, username list and task titles of a class
  whose code they know, and only their own device's hand-ins.
- The **maintainer** can see all data in the Firebase console and must say so to
  schools.

**Location.**
- Firestore data is in **europe-west1** (Belgium) or eur3, chosen once at creation
  (step 6).
- Firebase Authentication records have no location setting. Verify the current
  statement on Firebase's privacy page before telling schools.

**Retention and deletion.**
- Hand-ins are deleted automatically after `keepWeeks` (default 10, 1-52), with a
  warning and a download a week before.
- The teacher deletes single hand-ins, removes students and computers, deletes classes
  with everything in them, and can delete all their data and their sign-in record
  (T12).
- The maintainer reviews abandoned classes yearly (§6.3).
- Anonymous Auth records accumulate on Spark with no clean-up (no personal data; §2.7).

**Shared computers.**
- The teacher session is tab-scoped, with no "keep me signed in", and dashboard data is
  never cached on disk (memory cache).
- Review handoffs are cleared on sign-out and `pagehide`.
- Students have the per-tab and 20-minute confirmation, the name in the header, and
  "Leaving? Sign out" after each hand-in.

---

## 10. Open questions and remaining risks

| # | Question / risk | Status / recommendation |
|---|---|---|
| Q1 | Per-IP anonymous sign-up limit (100/hour) in schools behind one IP or CGNAT, worse where labs wipe browser data | §6.1 step 8: temporary increases before the launch week and each term start. Clear `signup_limit` text. Anonymous sign-in only at *Next*, never on page load |
| Q2 | Quota DoS across all schools (§3.5 item 3) | App Check wired; enforcement and Blaze are **maintainer decisions** (§3.6, §6.3) |
| Q3 | Capacity: Spark ≈ 35-40 schools of the reviewed profile | Monitor weekly; Blaze beyond that (§6.2-6.3) |
| Q4 | Any Google account can be a teacher | Keep open (like Tinkercad). If abused, add an email-domain allow-list in `isTeacher()` |
| Q5 | Impersonation by picking a classmate's name | v1: joining windows, rejoin per student, device visibility, Move to… PIN in v1.1 only if schools ask (§3.7) |
| Q6 | ASCII-only usernames | Keep for v1 (safe file names, typable, rule-checkable). Task titles and class names accept any language |
| Q7 | Transpiler escapes beyond X1's denylist | The sandbox is the real boundary. X1 is defence in depth; any new escape is a normal bug, not an account takeover |
| Q8 | SDK issue #10402 (a quota error at start-up clears the stored anonymous user) | Handled as `lost_identity` + "Let join again". Track the issue; bump `firebase` when it is fixed |
| Q9 | Co-teachers, feedback to students, QR code, printable username slips, "Delete older versions", task × student grid, restoring removed students with the same id, a French UI, class code rotation | v1.1+ |
| Q10 | Teacher sign-in blocked by Google Workspace admins | Documented (§6.1 step 13); personal Google accounts work |
| Q11 | Rules published by hand can drift from the repository | Step 7 ("publish before merging") + the optional `deploy-rules` CI job |
| Q12 | Firebase Auth data location statement for schools | The maintainer verifies it on Firebase's privacy page before publishing §9 to schools |

**Decisions the teacher / maintainer still has to make** (with this spec's defaults):

1. **App Check enforcement.** Default: monitoring only. Enforce from day one only for a
   small pilot (under about 500 students) or with billing enabled.
2. **Scale vs. Spark.** Default: stay on Spark up to about 35 schools of the reviewed
   profile, then Blaze with a $5 budget alert. Alternative: cap onboarding.
3. **Firestore location.** Default: `europe-west1`. Alternative: `eur3`. Irreversible.
4. **Default retention** `CLASSROOM_DEFAULTS.keepWeeks`. Default 10 weeks; 40 for a
   small deployment that wants whole school years.

---

## 11. Decisions log

Accept = folded into the spec as proposed. Adapt = the goal is met, differently.
Reject / defer = not in v1, with the reason given.

### Security review

| item | resolution |
|---|---|
| **B1** Student sketch runs on the teacher's origin | **Accept (preferred fix).** `review.html` runs the simulator in `<iframe sandbox="allow-scripts">` with CSP `frame-src 'self'` (§3.4, §1.4, §4.14). Verified in Chromium: the PoC read a planted secret, opened IndexedDB and a popup on the same origin, but got `SecurityError` / `null` inside the sandbox. **Also accepted**, the minimum items: review never auto-runs; teacher persistence is session-only and "Keep me signed in" is dropped (D13); **X1** transpiler/runtime denylist is a **v1 gate** (§3.4). §3.3 item 6 / Q9 of the draft replaced |
| **M2** Shared-fate DoS; App Check under-rated | **Adapt.** Facts restated: denied requests bill rule reads; App Check is available on Spark (§3.5). App Check is **wired in v1** (config key, both apps) and registered in step 9. Enforcement stays a **maintainer decision**: without billing, reCAPTCHA Enterprise returns errors after 10,000 assessments a month, so default enforcement would itself cause outages at scale (§3.6, cited). (a) **Code rotation: rejected for v1.** Reads can be spent on any path, valid code or not, so rotation does not reduce the quota lever. A leaked code cannot join while joining is closed or windowed (D14). It would add a lookup collection, a read per join and about 6 rule clauses. v1.1: "Copy class with a new code". (b) Reads on deny: **accepted**, request-only checks first, reads last (§3.1-3.2). (c) Runbook: **accepted** (§3.6, §6.3) |
| **m3** `ownerUid` visible to code-holders | **Accept (document).** §3.5 item 6 and R3.2 test. Kept, because it keeps teacher deletes read-free and the join check simple |
| **m4** Free text rendering | **Accept.** `textContent` is a MUST (§3.4) with a test matrix over all fields and views (§7.3) |
| **m5** Anonymous accumulation; soft 300 cap | **Accept.** §2.7, §9 |
| Positives (teacher gate, isolation, batch coupling) | Kept. Tests carried over and extended (R1.2, R4.9, R6.4, R6.5, R6.15) |

### Classroom UX review

| item | resolution |
|---|---|
| **B1** Open shows the wrong program and overwrites the teacher's saved work | **Accept.** (a) mode-from-link fix + test (§4.11). (b) The review link, implemented as the sandboxed review page: no storage at all in the frame, a trusted banner with who/class/task/time, and `document.title` "ali.k – ZERO1 review". "Keep a copy as my work" is **dropped**: it would move student code onto the site origin. Download .ino / Copy code instead |
| **B2** Wrong-name hand-ins on shared lab PCs | **Accept.** Per-tab + 20-minute Confirm view (Yes / someone else / Different class), My hand-ins hidden until confirmed, "Hand in as ali.k", "Leaving? Sign out" on success, name in the header (S3-S6), Move to… (M2) |
| **M1** Per-student Overview | **Accept, adapted:** built from roster + the loaded hand-ins (not member docs, per Feasibility 4), with New/Seen in localStorage, versions, computers, one-click Open / .ino, "22 of 28" (T5) |
| **M2** Fix wrong-name hand-ins | **Accept.** Owner re-file rule (studentId + username matching the roster, and taskId), tests R7.6; near-duplicate warnings; Remove the computer from the detail |
| **M3** Popup/clipboard after await | **Accept.** Open is a real `<a target=_blank>` (to review.html); content is decoded before enabling .ino/Copy; no toast (T5, §4.13) |
| **M4** Sign-in popup after await | **Accept.** SDK loaded at page load, button disabled until `ready`, `signInWithPopup` is the first statement; `setPersistence` is gone entirely (D13); test for synchronous call; iPad Safari in §7.7 |
| **M5** Header wraps at 1366 px | **Accept.** Short brand below 1536 px, "Hand in · ali.k" with ellipsis, re-measure list (§4.11) |
| **M6** Joining at the end-of-lesson rush | **Accept.** Class link `#class=` (S0), Copy class link, overlay link, docs advice. QR later |
| **M7** Close joining does not fit labs | **Accept, adapted:** a 15-minute window keyed on **server time** (`joinWindowAt`, rules check `== request.time`) instead of a client `joinUntil`, plus Feasibility 6's per-student rejoin (D14, R4.2-R4.3, R3.6) |
| **M8** After Hand in / slow Wi-Fi | **Accept.** Success view; the id is made before the batch and reused; member read on timeout / permission → `arrived` (§2.9, R6.16, e2e) |
| **M9** Untouched example / blank | **Accept.** `unchanged` + second click; `errorCount` note (S3) |
| **M10** Which task | **Accept (the better variant).** `tasks` map ≤ 30, `currentTaskId`, hand-in `taskId` checked by rules, filter on dashboard (§2.5, R2.4, R6.13). Task × student grid v1.1 |
| **M11** Old classes keep accepting | **Accept.** `handinsOpen` (rules for join and hand-in, R4.4, R6.14), `handins_closed` text, Different class |
| **M12** Download all | **Accept.** Store-only zip: latest of each student, all shown, and "download them" before retention deletes (T5, T9, §2.11) |
| **M13** Full surnames | **Accept.** "Shorten last names to an initial", on by default (T3, §2.4) |
| **M14** Member docs pile up | **Accept.** Amber only for "2 computers within an hour"; Remove unused computers (30 days); members listener bounded to 150 and only while visible; §6.2 includes re-joins |
| **m1** Code look-alikes | **Accept.** 24-symbol alphabet, `2 5 6 8` mapping, error names the character, placeholder `BKT-4M9` (D2, R1.4) |
| **m2** Two nearly identical buttons | **Accept.** One "Not ali.k? Sign out" + "Different class" (S6) |
| **m3** Teacher link in the student dialog | **Accept.** Removed; a teachers line in Share, README, docs (§4.12) |
| **m4** Quota reset time | **Accept.** `quotaResetText()` via Intl, `{reset}` in texts (§1.5) |
| **m5** Pick view | **Accept.** Refresh the list, Enter keys, scroll box, "can't find your name" (S2) |
| **m6** Restore removed student with the same id | **Defer to v1.1.** Rare; hand-ins keep the username snapshot; workaround = re-add + Move to… (§2.4) |
| **m7** Default period 14 days | **Adapt.** Default **Today** (Feasibility 4: live and cheapest; it answers "who handed in this lesson"), 14 days offered, and the choice is **remembered per class** (T5) |
| **m8** Layout at 1366 px | **Accept.** Class switcher in the top bar; full width (§1.3, §4.13) |
| **m9** Accessibility | **Accept** (T5, T10) |
| **m10** Last handed in on Ready | **Accept** (`lastHandinTitle` in the session, S3) |
| **m11** Wording | **Accept** (§1.5 texts rewritten) |
| Later list | Kept in Q9 |

### Feasibility review

| item | resolution |
|---|---|
| **1** Load does not fit Spark; no retention | **Accept.** §6.2 rewritten with a stated ceiling (≈ 35-40 schools of the profile; 50 is over Spark); mandatory retention `keepWeeks` (default 10, from config) with warning + download (D16, §2.11); escalation rule (§6.3); gzip `Bytes` with plain fallback (D7); limits 50,000 / 100,000 B |
| **2** Split hand-in docs spend scarce resources | **Accept.** One doc per hand-in; batch of 2; tick bound with `getAfter(handin).createdAt == request.time` (+ uid); 3 rule reads per hand-in. Dropping `get(class)` was **not** taken: `handinsOpen`, tasks and current roster names need it |
| **3** Indexes / emulator gap / silent fallback | **Accept.** Field overrides for every non-queried field, including `uid`/`studentId` on hand-ins (covered by composites); no fallback → `index_missing` + console link; step 7 mandatory; smoke test runs both composite queries (§2.12, §6.1) |
| **4** Listener read cost | **Accept.** Today live, longer periods one-off with Refresh; members only while visible and bounded; previous class kept 10 min; `restore()` reads only the class; the cost of the memory cache recorded (§6.2). Persistent cache **not** used (privacy on shared teacher PCs, decided) |
| **5** Popup blocked on Safari/iPad; `deleteAccount` popup | **Accept.** As UX M4, plus T12 split into two steps with `reauthenticateWithPopup` in the click; `firebase ^12.19.0` |
| **6** Anonymous sign-in does not survive | **Accept.** Per-student rejoin, Remove unused, bounded members, sign-up quota scheduling (step 8), `authStateReady()` + `lost_identity`, #10402 tracked (Q8) |
| **7** Repeated deletes fail; account deletion vs quota | **Accept.** `canDelete()` allows deleting a missing doc (R3.11, R5.3, R7.7); budgeted, resumable runs (5,000 per run) |
| **8** Bundle sizes; the source scan misses chunk sharing | **Accept.** Numbers updated; `scripts/check-bundle.mjs` (§7.5) |
| **9** Stale chunks after deploy | **Accept.** `app_updated` + Reload after flushing autosave; deploy outside school hours (§4.11, step 10) |
| **10** Setup guide outdated | **Accept, all items.** localhost, temporary quota changes, App Check facts, Identity Platform reason corrected, Google Auth Platform "In production", local reset time, regional location (steps 3-9) |
| **11** CI details | **Accept.** Separate `~/.npm/_npx` cache, `ci.yml` for PRs with its own concurrency, optional `deploy-rules` job (§7.6) |
| **12** Retried hand-in duplicates | **Accept** (§2.9, R6.16, e2e) |

---

## Appendix A. Sources

`firebase.google.com`, `docs.cloud.google.com`, `github.io` and `www.tinkercad.com` could
not be opened from this environment: the proxy refused them. The Firebase and Google
facts below come from web-search extracts of the listed pages (September 2026). The
maintainer should re-check them while following §6.1.

- **Spark Firestore quotas**: 50,000 reads, 20,000 writes and 20,000 deletes per day,
  1 GiB stored, reset around midnight Pacific. https://firebase.google.com/docs/firestore/quotas,
  https://firebase.google.com/pricing, https://docs.cloud.google.com/firestore/quotas
- **Rule reads**: `get`/`exists`/`getAfter`/`existsAfter` are billed reads, also on
  denied requests; access-call limits 10 / 20; cached calls are not counted.
  https://firebase.google.com/docs/firestore/security/rules-conditions,
  https://firebase.google.com/docs/firestore/pricing,
  https://firebase.google.com/docs/reference/rules/rules.firestore
- **Listener billing**: after a reconnect, only the changes are billed when the query
  resumes within 30 minutes **with persistence**.
  https://firebase.google.com/docs/firestore/pricing,
  https://github.com/firebase/firebase-js-sdk/pull/7229
- **Storage size** (index entries count):
  https://firebase.google.com/docs/firestore/storage-size.
  **TTL needs billing**: https://firebase.google.com/docs/firestore/ttl
- **Auth limits**: 100 new anonymous or email accounts per hour per IP; temporary
  changes can be scheduled in the console. https://firebase.google.com/docs/auth/limits
- **Anonymous auth**: automatic clean-up after 30 days only with Identity Platform, and
  such accounts then do not count toward usage limits.
  https://firebase.google.com/docs/auth/web/anonymous-auth
- **Authorized domains**: `localhost` is not added by default for projects created
  after 2025-04-28. https://firebase.google.com/docs/auth/web/email-link-auth,
  https://firebase.google.com/docs/auth/web/google-signin
- **Redirect vs popup** off Firebase Hosting (third-party storage blocking): use the
  popup. https://firebase.google.com/docs/auth/web/redirect-best-practices
- **Popup blocking**: https://github.com/firebase/firebase-js-sdk/issues/8033,
  https://github.com/firebase/firebase-js-sdk/issues/6956;
  iPad regression and its fix: https://github.com/firebase/firebase-js-sdk/issues/10318,
  https://github.com/firebase/firebase-js-sdk/pull/10325;
  stored user cleared on a quota error: https://github.com/firebase/firebase-js-sdk/issues/10402;
  user activation: https://webkit.org/blog/13862/the-user-activation-api/
- **App Check with reCAPTCHA Enterprise**:
  - token lifetime from 30 minutes to 7 days, refreshed at about half of it;
  - on Spark, only 4 score levels;
  - 10,000 free assessments a month, and **errors after that without billing**.
  https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider,
  https://firebase.google.com/docs/app-check,
  https://docs.cloud.google.com/recaptcha/docs/billing-information,
  https://docs.cloud.google.com/recaptcha/docs/migrate-recaptcha
- **OAuth consent** ("Testing" allows only test users):
  https://developers.google.com/workspace/guides/configure-oauth-consent
- **Firestore locations** (cannot change after creation):
  https://firebase.google.com/docs/firestore/locations
- **GitHub Pages** serves every public file with `Access-Control-Allow-Origin: *`,
  which cannot be changed. https://github.com/orgs/community/discussions/157852,
  https://github.com/orgs/community/discussions/22399.
  Pages `max-age=600`: https://github.com/orgs/community/discussions/11884
- **Vite `vite:preloadError`**: https://vite.dev/guide/build
- **URL length** (Safari fails around 80,000 characters in practice):
  https://www.baeldung.com/cs/max-url-length
- **WebKit tracking prevention** (7-day storage cap): https://webkit.org/tracking-prevention/
- **Tinkercad classrooms** (class code or link plus nickname):
  https://www.tinkercad.com/help/classrooms/join-a-class,
  https://www.tinkercad.com/blog/classroom-links-simplify-sign-on

## Appendix B. Verification log (this environment, 2026-09-26)

- **Tools**: firebase-tools 15.31.0, `cloud-firestore-emulator-v1.22.0.jar`, OpenJDK 21,
  `firebase` 12.19.0, `@firebase/rules-unit-testing` 5.0.2, vitest 3, Chromium 1194
  (playwright-core).
- **Rules**: `final/rules/tests/rules.test.ts` against `final/rules/firestore.rules`,
  run with `firebase emulators:exec --only firestore`: **78 passed**.
  - The first run found that `join()` turns non-string values into text. That is
    documented as R2.6 (owner-only data; nobody can join as such an entry).
- **End to end**: `final/rules/tests/e2e.test.ts` with `--only auth,firestore`: **passed**
  (79 of 79 together with the rules tests). It covers:
  - a transaction create with a server-time join window;
  - a Lite anonymous join;
  - a gzip `Bytes` hand-in with `increment(1)`;
  - a retry with the same id → `permission-denied`, and the member doc shows the id;
  - the Today listener `added`, capped inflation, a 5 MB bomb refused;
  - a re-file → `modified`;
  - sign-out → a new uid with no access.
- **Mutations** (`final/rules/mut/`): each deletes one protection. **10 of 10 caught**:

  | mutation | caught by |
  |---|---|
  | tick not bound to a new hand-in | R4.8, R4.9 |
  | join window never expires | R4.2 |
  | rejoin for any student | R4.3 |
  | `handinsOpen` ignored | R6.14 |
  | re-file any field | R7.6 |
  | delete not idempotent | R3.11, R5.3, R7.7 |
  | encoding types unchecked | R6.3 |
  | client-time window | R3.6 |
  | task unchecked | R6.13 |
  | rejoin keys unchecked | R3.7 |

- **Sandbox** (`final/sandbox/probe*.mjs`): the current `dist/` build, served with
  `Access-Control-Allow-Origin: *`, inside `<iframe sandbox="allow-scripts">` under
  `frame-src 'self'`.
  - `self.origin === 'null'`.
  - `localStorage`, `indexedDB` and `parent.document` throw `SecurityError`.
  - The sketch from the hash is in the editor. Run shows "Running", and Serial prints
    "hello from sandbox". The Blocks lazy chunk loads.
  - Navigating the frame to `https://example.com/` is refused by CSP.
  - The same page **without** the CORS header does not load (module script blocked for
    origin `null`).
- **Escape PoC** (`probe4.mjs`), `Serial.constructor.constructor(…)`:
  - same origin: `own-ls=TEACHER-TOKEN | parent-ls=TEACHER-TOKEN | idb:open | popup:opened`;
  - sandboxed: `own-ls:SecurityError | parent-ls:SecurityError | idb:SecurityError | popup:null`.
- **Gzip sizes**: the 21 `.ino` examples average 2,356 B raw → 1,067 B gzip. A 96-byte
  sketch gzips to 99 B, so it is stored plain.
