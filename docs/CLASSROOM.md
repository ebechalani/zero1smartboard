# ZERO1 Classes: class platform specification (FINAL)

Status: final specification, 2026-09-26, **simplified by teacher decision on 2026-09-27**
(see the last entry of the [Decisions log](#11-decisions-log)): there is no class list,
no tasks and no joining window any more. A student types the class code, then their
first name and last name, and the work is handed in. Sections that the simplification
touched were rewritten briefly; the rest (security model, sandbox, quotas, setup) is
unchanged.

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
    link** (`…/zero1smartboard/#class=BKT4M9`). There is nothing else to prepare.
- **Student**
  - Opens the class link, or chooses **Share ▾ → Hand in to my teacher** and types the code.
  - **Types their first name and last name.** There is no email and no password: the
    student uses Firebase Anonymous Authentication. The device remembers the code and
    the name, so the next time it is one click ("Hand in as Ali Khoury to class BKT-4M9").
  - Hands in the current sketch (Code mode) or blocks program (Blocks mode, with the
    sketch generated from it).
- **Dashboard**: the teacher checks the work there.
  - The **Overview** has one row per student name: who handed in, what is new, versions.
  - The teacher reads the code and downloads the `.ino` (one file, or a `.zip`).
  - **Open** runs the hand-in in the simulator. It runs inside a **sandboxed review
    page**, so a student's sketch can never touch the teacher's session (§3.4).
- **Backend**: Firebase Authentication and Cloud Firestore on the free **Spark** plan.
  There is no server code: all logic is client code plus Firestore Security Rules.
- **Email relay**: the platform **replaces** it (tools/email-relay, docs/EMAIL.md,
  `EMAIL_RELAY_URL`, "Send to teacher"). The Share menu keeps **Copy link** and **Download .ino**.
- **Not configured**: until `src/firebase-config.ts` is filled in, the simulator has no
  Hand in menu item and never downloads Firebase. The teacher page says "not set up yet".

### 0.2 Fixed decisions (from the teacher; not re-opened)

- Teachers sign in with Google. Students use anonymous auth.
- **Hand in is very simple (2026-09-27):** the teacher creates a class code and gives it
  to the students; a student enters the class code, then their first name and last name,
  and the work is handed in. No class list, no tasks, no joining windows.
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
| D3 | ~~The roster is a map on the class doc~~ **Superseded (2026-09-27):** there is no roster. The student's name lives on the member doc and is copied onto each hand-in (`firstName`, `lastName`, `nameKey`). | One flow for students; nothing for the teacher to type. The dashboard groups hand-ins by `nameKey`. |
| D4 | One **member** doc per device (anonymous uid) per class, created by the student with the typed name. The student may later change the name (the three name fields only); the counter stays. | Binds a uid to a name. The teacher sees and removes computers. |
| D5 | **Change = the same anonymous uid**, renamed in place. | The 300-per-device cap and the cooldown survive a change of name; no accumulation of anonymous accounts on shared PCs. |
| D6 | **One document per hand-in**: metadata plus content. The batch has **2 writes**: the hand-in and the member counter tick. | Spark is short of reads and writes, not bandwidth (Feasibility 2). The rules enforce a 10 s cooldown and 300 hand-ins per device. |
| D7 | Content is **gzip bytes** (`CompressionStream`), with a plain-string fallback. Limits: sketch 50,000 B, workspace 100,000 B. | Storage lasts about 3× longer (§6.2). The dashboard inflates with a cap (gzip bombs). |
| D8 | Students read only hand-ins with **their own uid** (kept in the rules; the dialog no longer lists them). The teacher reads the whole class. | A student cannot copy a classmate's work by typing their name. |
| D9 | The teacher runs a hand-in on **`review.html`**. The simulator runs there in an `<iframe sandbox="allow-scripts">` (opaque origin). | A crafted sketch escapes the transpiler (proven). In the sandbox it cannot read the site's storage or the dashboard (verified in Chromium, §3.4). |
| D10 | Two named Firebase apps: `z1-student` and `z1-teacher`. | A teacher session and a student session never replace each other. |
| D11 | The student side uses **Firestore Lite** (REST), loaded with `import()` on first use. | About 62 KB gzip, against about 170 KB for the full SDK. |
| D12 | The teacher side uses the full SDK. **Today** is a live listener; longer periods are one-off paged reads. **Memory cache only.** | Live lesson view at the lowest read cost. No student data is left on shared teacher PCs. |
| D13 | Teacher sign-in: `signInWithPopup` called synchronously in the click. **Session persistence only** (the "Keep me signed in" option is removed). | Safari/iPad block a popup after an `await`. No teacher token sits in shared storage on the github.io origin. |
| D14 | ~~Joining windows~~ **Superseded (2026-09-27):** there is no joining control. Anyone with the code can hand in under any name while the class accepts hand-ins (`handinsOpen`). | The teacher asked for the simplest possible hand-in. The teacher deletes what does not belong (§3.5). |
| D15 | ~~Tasks~~ **Superseded (2026-09-27):** no tasks, titles or notes on a hand-in. | Simplicity. The Overview shows the latest version per student. |
| D16 | **Retention**: `keepWeeks` per class (default 10, set by the maintainer). The dashboard prunes older hand-ins when a class is opened, with a warning a week ahead and a `.zip` download. | 1 GiB of storage and the delete quota both need it at the stated load (§6.2). |
| D17 | Deletions are client batches (at most 400 operations, at most 5,000 deletes per run), resumable through `deleting: true`. Deleting a doc that is already gone is allowed. | No Cloud Functions. Retries and two open tabs never fail a batch. |
| D18 | App Check (reCAPTCHA Enterprise) is **wired in v1**, starts in monitoring mode, and is **enforced by the maintainer's decision** (§3.6). | It is free for only 10,000 assessments a month. Past that, requests fail without billing. |
| D19 | No per-student PIN in v1; the data model leaves room for it (§3.7). | Cost and benefit. |

### 0.4 Architecture

```
 simulator (index.html)                    teacher.html                       review.html
 ┌────────────────────────────────┐        ┌────────────────────────────┐     ┌─────────────────────────────┐
 │ header: [Share · Ali Khoury ▾]   │       │ src/teacher/* (vanilla DOM) │     │ trusted banner + Download   │
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

> Historical (2026-09-26, the roster model). The simplified platform was verified again on
> 2026-09-27: 62 rules cases, 10 of 10 new mutations caught (§7.1), the API suites and the
> end-to-end flow on the emulators, and a browser run of code → name → Hand in (§7.4).

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
  - No **Hand in to my teacher** item in the Share menu: it is absent from the DOM, not hidden.
  - `src/classroom/*` is never imported, and no request goes to a Google host.
  - A `#class=` link shows the toast "Classes are not set up on this site." and is ignored.
  - The Share menu shows Copy link and Download .ino only.
- **teacher.html**: one card, with no Firebase download:
  - "The class platform is not set up on this site yet."
  - For the maintainer: "Follow docs/CLASSROOM.md to create the Firebase project and
    paste its web config into src/firebase-config.ts." (link to the file on GitHub)
  - A link back to the simulator.
- **review.html** works: it never uses Firebase.
- Emulator mode (`vite --mode emulator`, §4.16) counts as configured.

### 1.2 Student flows (simulator, Hand in dialog)

One short flow: **class code → first name + last name → Hand in**. The device remembers
the code and the name.

**Header.** The entry point is the **Share ▾** menu (Copy link, Download .ino and, when
the class platform is configured, **Hand in to my teacher**); there is no separate Hand in
button.
- While a name is remembered, the Share button reads **Share · Ali Khoury**. Otherwise **Share**.
- The name comes from the saved session, read synchronously at start-up. So the next
  student at a lab PC sees the previous student's name until they press **Change**.
- Choosing **Hand in to my teacher** builds the work like Copy link does (`exportSketch()`)
  and opens the dialog in **Loading** ("Connecting to your class…"), which calls `api.restore()`.
- If the blocks are still loading, the app shows the toast "The blocks are still
  loading — try again in a moment" and opens no dialog.

**S0 Class link** `…/#class=BKT4M9`. At start-up the app takes the hash and removes it,
as with `#code=`. It opens the dialog on the Code view with the code prefilled; when the
device already remembers that very class, it opens the Ready view instead.

**S1 Code view.**
- Heading: "Hand in your work to your teacher".
- Input *Class code*: `autocapitalize="characters"`, placeholder `BKT-4M9`, prefilled
  with `z1.classroom.lastCode`.
- **Next**, or Enter in the field.
- The client checks the code with `normalizeClassCode`. An invalid code shows an inline
  message and makes no request: "A class code has 6 letters and digits, like BKT-4M9."
  plus the detail from `codeProblem()`, ending with "Check it with your teacher."
- A valid code calls `api.findClass(code)` (anonymous sign-in if needed: the first
  Firebase download happens here).
- Errors (inline): `class_not_found`, `handins_closed`, `offline`, `timeout`,
  `signup_limit`, `auth_disabled`, `storage_blocked`, `quota`, `load_failed`,
  `app_updated`, `unknown`.

**S2 Name view.**
- Heading: "Class **8B Robotics**", then "Type your name so your teacher knows whose
  work this is."
- Two inputs, *First name* and *Last name* (each 1-30 characters after `cleanName`;
  letters of any alphabet, spaces, `'`, `.` and `-`; accents kept). They are prefilled
  with the name this device gave before (its member doc, else the saved session).
- The work line ("Your Arduino sketch, 42 lines", "Your blocks program and the Arduino
  sketch made from it" or "Your Python program and the Arduino sketch made from it") and
  the warnings of S3 are shown here too.
- **Hand in** (or Enter in a field) runs the local checks of S3, then `api.join(found,
  name)` (create or rename this device's member doc), then the Ready view and the send.
- **Back** returns to the code.
- Errors (inline, the view stays): `bad_name`, `handins_closed`, `class_not_found`,
  `offline`, `timeout`, `quota`, `permission`, `unknown`.

**S3 Ready view** (the remembered computer).
- "Hand in as **Ali Khoury** to class **BKT-4M9** · 8B Robotics", with **Hand in** and a
  small **Change** link.
- "Last handed in: today 10:42" when this device has handed in before.
- The work line and the warnings from `HandinWork`:
  - `unchanged: 'example'`: "This is still the example '{title}'. Hand it in anyway?"
    and `unchanged: 'blank'`: "Your sketch is still the empty starting sketch. Hand it
    in anyway?" (Python: "Your Python program is still the empty starting program. Hand
    it in anyway?") are shown as a warning line, and **Hand in** asks the same question
    once with a confirm dialog (`options.confirm`).
  - `errorCount > 0`: "Your sketch has {n} errors. Your teacher will see them." (a note).
    Python: "Your Python program has {n} errors. Your teacher will see them.", with {n}
    read from the placeholder sketch a program with errors hands in (`placeholderErrorCount`,
    docs/PYTHON.md §4.10 T9); such a hand-in is allowed, the teacher sees the program.
- **Python hand-ins** (docs/PYTHON.md §8.3): the App passes `kind: 'python'`, `code` = the
  sketch made from the program (or the placeholder), `python` = the program, `unchanged` for
  `BLANK_PYTHON` or an untouched Python example.
- Client checks before any request: `empty_sketch` (Python: "Your Python program is empty.
  There is nothing to hand in yet."), `too_large` (sketch 50,000 / Blocks workspace 100,000 /
  Python program 50,000 UTF-8 bytes), `too_soon` (10 s since the last hand-in from this
  device), `offline`.
- The dialog keeps one `handinId` (`newHandinId()`) per draft. Retries reuse it (§2.9).
- The button shows "Handing in…" and is disabled: one request at a time. After the
  request timeout the status reads "Checking whether it arrived…" (the API reads the
  member doc).
- **Change**: `api.forget()` (the saved session is cleared; the anonymous uid and the
  last code are kept), then the Code view with the code prefilled. Next → Name view,
  prefilled with the current member name, editable. This is also the shared-computer
  protection: the Ready view always shows who the work will be handed in as.

**S4 Success view.** "✓ Handed in · 10:42 · Your teacher can see it now." with **Close**.
The next opening shows the Ready view again with "Last handed in".

**Errors after sending** (after the data layer's diagnosis, §4.7):
- `timeout`, `offline` after sending, `unknown`: "It did not arrive. **Try again**"
  (the same id);
- `too_soon`, `limit_reached`, `quota`, `permission`, `unknown`: inline in the status line;
  a `permission` refusal of a **Python** hand-in reads "Your class is not ready for Python
  hand-ins yet: ask your teacher to update the class rules." (rules published before Python
  hand-ins refuse them, §3.1 and docs/PYTHON.md §11.4);
- `device_removed`: button **Enter your name again** (= Change);
- `class_deleted`: the session is cleared, button **Different class**;
- `handins_closed`: button **Different class** (the code is forgotten too);
- `lost_identity`: the Code view with the code prefilled and the text.
- A name changed from another tab is handled inside `handIn`: one automatic retry with
  the member doc's name, and the header updates.

`restore()` errors: `device_removed` → **Enter your name again**; `class_deleted` →
**OK** (session cleared); `handins_closed` → **Different class**; `lost_identity` →
Code view; `offline` → **Try again** (the saved session is kept).

The dialog footer has **Close** only. Esc closes the dialog; while it is open, Ctrl+Enter
and Esc do not run or stop the sketch (the App's keyboard guard).

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
- Cards, newest first (sorted client-side by `createdAt`). Each card shows the class
  name, the formatted code and a badge: "Hand-ins open", "Hand-ins stopped" or
  "Deletion not finished".
- A section **Hand-ins stopped** collects old classes.
- Empty state: "No classes yet. Create your first class."
- Live through `watchClasses`. The last opened class (`z1.teacher.lastClass`) is
  re-opened **only when it is in this teacher's class list** (the key is per browser: on
  a shared PC it may name another teacher's class); otherwise the list shows and the key
  is dropped.

**T3 Create class** (dialog).
- *Class name* (required, 1-60 characters after `cleanLine`). Nothing else: "You get a
  class code to give your students. They press Hand in, type the code and their name:
  no class list to prepare."
- **Create** calls `createClass({ name })`, a transaction with code-collision retry.
- The class then opens with a banner: "Class created. Give your students the code
  **BKT-4M9** or the class link."
- Errors: `code_collision`, `offline`, `quota`, `permission`, `unknown`.

**T4 Class page header.**
- The class name.
- The big formatted code, with **Copy code**, **Copy class link** and **Show to the class**.
- The switch **Accepting hand-ins** (on/off). On: "Anyone with the code can hand in under
  their name." Off: "This class no longer accepts hand-ins (use it for last year's
  classes)."
- Tabs: **Overview** | **All hand-ins** | **Settings**.
- Opening the class starts the background retention check (§2.11). Its notices appear
  on the Overview.

**T5 Overview** (default tab, M1).
- **Period** select:
  - **Today** (default, live: `watchTodayHandins`);
  - **Last 7 days**, **Last 14 days**, **Last 30 days**: one-off `loadHandins`, with a
    **Refresh** button.
  - The choice is remembered per class in `z1.teacher.period.<code>`.
- Header line: "12 students handed in today" (or "…in the last 7 days"): the distinct
  names (`nameKey`) with at least one hand-in in the view.
- One row per student name (**"Last name, First name"**, grouped by `nameKey`, so
  "ali khoury" and "Ali Khoury" are one student), sortable by name (default) or by
  last hand-in. Keys ↑/↓ move between rows; Enter opens the detail. Columns:
  - **Status**, always as text plus an icon:
    - "● New": a hand-in newer than the `seen` mark in
      `z1.teacher.seen.<code>` (nameKey → createdAt ms);
    - "✓ Seen".
  - **Last hand-in**: time ("10:42" today, "Mon 10:42" this week, else the date) ·
    Code / Blocks / Python.
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
    click and the download. Disabled for a Python hand-in with errors (its title says
    "Handed in with {N} Python errors: there is no sketch to download").
- Opening the detail, **Open** or **.ino** marks the student as seen.
- Buttons:
  - **Download latest of each student (.zip)**: from the loaded view, no reads;
  - **Download all shown (.zip)**.
- Live insertions are announced by one polite summary ("2 new hand-ins"). The new-row
  highlight respects `prefers-reduced-motion` and always carries the "New" text.
- Empty: "Nothing handed in yet. Students press Hand in, type the class code and their
  name."
- A large review payload (`#rid=`) gets **one** `z1.review.<rid>` handoff per hand-in,
  memoised on the session and reused across renders.

**T6 Hand-in detail** (panel beside the table at 1200 px or more, else below it).
- The student's versions, newest first.
  - Versions in the view are shown; "3 earlier versions" is collapsed.
  - **Load older versions** calls `studentHandins` (10 per page).
- Each version shows:
  - the time;
  - the computer: `shortDeviceId(uid)`, plus the device label when members are loaded;
  - **Code** / **Blocks** / **Python** (`z1t-kind-python`);
  - a read-only `<pre>` code preview (`textContent`). For Blocks, the sketch generated
    from the blocks, labelled so.
  - **Python** (docs/PYTHON.md §8.5): the program first (monospace `<pre>`,
    `textContent`), then a collapsed `<details>` "The Arduino sketch made from it" with the
    sketch. Readers take the program from the stored workspace with `contentOf(kind,
    decoded)` (§2.8). When `placeholderErrorCount(code)` is a number (the program had errors,
    so the stored sketch is the placeholder): the note "Handed in with {N} Python errors" above
    the program, and **Download .ino** disabled with that reason.
- Actions:
  - **Open in the simulator** (a link, as in T5);
  - **Download .ino**: `sketchFileName("First Last", createdAt)`. For Blocks, the zip
    download also adds `<First_Last>.blocks.json`.
  - **Download .py** (Python, before Download .ino): `pythonFileName("First Last",
    createdAt)`, e.g. `zero1_ali_khoury_0926_104200.py`, as the student's own Download .py.
  - **Copy code**: enabled when decoded; copies the program for Python, else the sketch.
    Fallback: select that `<pre>` text and say "Press Ctrl+C".
  - **Remove the computer that sent this**: confirm, then `removeDevice(code, uid)`.
    (There is no "Move to…": hand-ins are immutable; a wrong name is deleted and the
    student hands in again.)
  - **Delete**: confirm "Delete this hand-in? This cannot be undone.", then `deleteHandin()`.
- Content that cannot be decoded shows:
  - `too_large`: "This hand-in is larger than the simulator accepts. It was not made by
    the ZERO1 page." Open, .ino and Copy are disabled.
  - `unsupported`: "Your browser cannot unpack this hand-in. Update your browser."
  - `corrupt`: "This hand-in is damaged."

**T7 All hand-ins.** A feed of the same view, newest first:
- time, "Last name, First name", a **Code** / **Blocks** / **Python** badge;
- a filter by student (the names in the view);
- the same detail panel.

**T8 Students.** Removed with the roster (2026-09-27). The members listener runs only
while a detail panel needs the device labels. `removeUnusedDevices` stays in the API.

**T9 Settings.**
- Rename the class (**Save** → `updateClass`).
- The **Accepting hand-ins** switch (the same as in the header).
- **Keep hand-ins for** [1-52] weeks (`keepWeeks`). Help: "Older hand-ins are deleted
  automatically when you open this class. You are warned a week before."
- **Delete class**:
  - Explanation: "Deletes the class, all hand-ins and all joined computers. This cannot
    be undone."
  - Link: **Download everything first (.zip)**: pages through **every** hand-in of the
    class (`loadHandins` from the beginning of time until `hasMore` is false), not only
    the loaded view, and reports "n hand-ins in the zip".
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
- "Open the link, or press **Hand in**, type the code and your name."
- "Hand-ins open · 12 students handed in today" (from the loaded view; no members
  listener).
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
- A **Python** hand-in (docs/PYTHON.md §8.5): the banner ends "· Python"; **Download .py**
  (`pythonFileName(who, at)`) comes before **Download .ino**; **Copy code** copies the
  program; while it was handed in with errors (`placeholderErrorCount(code)` is a number) the
  banner adds "Handed in with {N} Python errors" and **Download .ino** is disabled with that
  reason. Inside the frame a Python hand-in shows the handed-in sketch in Code mode until the
  simulator's Python review mode lands (docs/PYTHON.md §7.13).
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
| `handins_closed` | `handinsOpen === false` | {class} no longer accepts hand-ins. If you have a new class code, choose Different class. | - |
| `class_deleted` | class doc missing / `deleting` after joining | This class no longer exists. | - |
| `lost_identity` | saved session, but the anonymous user is gone | This computer lost its class sign-in. Enter the class code and your name again. | - |
| `device_removed` | own member doc missing | Your teacher removed this computer from the class. Enter your name again. | - |
| `too_soon` | less than 10 s since the last hand-in | Wait a few seconds before handing in again. | - |
| `limit_reached` | member `handinCount >= 300` | This computer has handed in 300 times in this class. Tell your teacher. | - |
| `empty_sketch` | nothing to hand in | Your sketch is empty. There is nothing to hand in yet. | - |
| `too_large` | size limits | Your work is too big to hand in (more than 50,000 characters of code). Use Share → Download .ino instead. | - |
| `code_collision` | 5 codes taken in a row | - | Could not find a free class code. Try again. |
| `bad_name` | a first or last name failed `nameProblem` | Type your first name and your last name (letters only, up to 30 characters each). | That name is not valid. |
| `classes_left` | `deleteAccount()` while classes remain | - | Delete all your classes first (step 1). |
| `permission` | `permission-denied` without a better diagnosis | The class did not accept this. Try again; if it keeps failing, tell your teacher. | You do not have access to this class. Sign in with the account that created it. |
| `unknown` | anything else | Something went wrong. Try again. | Something went wrong: {message}. Try again. |

`renamed` (the member doc's name differs from the session's) is internal to the data layer and never shown.

---

## 2. Data model (Cloud Firestore, database `(default)`)

### 2.1 Tree

```
classes/{code}                  code = doc id, e.g. "BKT4M9"
  ├─ members/{uid}              uid = anonymous Firebase uid of a device
  └─ handins/{handinId}         handinId = 20 × [A-Za-z0-9] (made by the client before the batch)
```

There are no other collections and no `teachers` or `users` collection. The Google
profile stays in Firebase Auth; no teacher name is stored in Firestore. The draft's
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
- **No code rotation in v1** (decision log, Security 2a). A class whose code leaked is
  switched to "Hand-ins stopped" and a new class is created (a new code). v1.1: "Copy
  class with a new code".

### 2.3 `classes/{code}`

| field | type | rule / limit | notes |
|---|---|---|---|
| `schema` | int | `== 2` at create, immutable | 2 since the simplification (1 = the roster model; no v1 data was deployed) |
| `ownerUid` | string | `== request.auth.uid` at create, immutable | the teacher's Google uid. Visible to code-holders (§3.5) |
| `name` | string | 1-60 chars | "8B Robotics" |
| `handinsOpen` | bool | | false = no hand-ins and no new names ("Hand-ins stopped") |
| `keepWeeks` | int | 1-52 | retention (§2.11); default `CLASSROOM_DEFAULTS.keepWeeks` |
| `deleting` | bool | `false` at create | set first when deleting (§2.11) |
| `createdAt` | timestamp | `== request.time` at create, immutable | `serverTimestamp()` |
| `updatedAt` | timestamp | `== request.time` on every write | `serverTimestamp()` |

Exactly these keys exist at create. An update may change `name`, `handinsOpen`,
`keepWeeks` and `deleting`, and MUST set `updatedAt`. There is no roster, no task list,
no teacher name and no joining window (2026-09-27).

### 2.4 Student names

A student types a **first name** and a **last name**; nothing is prepared by the teacher.

- `cleanName(input)`: NFC, one line, single spaces, trimmed, at most 30 characters.
- `nameProblem(name)`: `'empty' | 'too_long' | 'invalid' | null`, with
  `NAME_PATTERN = /^\p{L}[\p{L} '.-]{0,29}$/u`: a letter of any alphabet (accents kept),
  then letters, spaces, apostrophes, dots and hyphens. The rules use the same regex
  (RE2, `\p{L}`).
- `nameKey = "first last".toLowerCase()`: the dashboard's **grouping key** ("ali khoury"
  typed on two computers is one student). The rules check that it is a non-empty
  lower-case string of at most 61 characters, but not the exact formula: the rules'
  `lower()` is ASCII-only, so "Élise" would be refused. The key has no security value
  (a student can type any name anyway, §3.5).
- Display: "Ali Khoury" (`fullName`) in the dialog and the review banner; "Khoury, Ali"
  (`listName`) in the dashboard lists.
- File names: `sketchFileName("Ali Khoury", …)` → `zero1_Ali_Khoury_0926_104200.ino`;
  zip entries `Ali_Khoury.ino`, `Ali_Khoury-2026-09-26-1000.ino`.

### 2.5 Tasks

Removed (2026-09-27). A hand-in has no task, title or note.

### 2.6 Joining

Removed (2026-09-27). A student may create their member doc, and hand in, whenever the
class exists, is not deleting and has `handinsOpen == true`. There is no window and no
per-student control: anyone with the code can hand in under any name (§3.5).

### 2.7 `classes/{code}/members/{uid}` (device ↔ name binding)

| field | type | at create | later |
|---|---|---|---|
| `firstName`, `lastName` | string | `validName` (§2.4) | changed only by the owner uid ("Change"), both together with `nameKey` |
| `nameKey` | string | non-empty, lower-case, ≤ 61 chars; the client's `nameKeyOf(first, last)` | as above |
| `ownerUid` | string | must equal the class `ownerUid` | immutable (lets the teacher read and delete without a `get`) |
| `joinedAt` | timestamp | `== request.time` | immutable |
| `device` | string | ≤ 40 chars, from `deviceLabel(navigator.userAgent)` | immutable. **Untrusted free text** |
| `handinCount` | int | `0` | `+1` per hand-in, ≤ 300 |
| `lastHandinAt` | timestamp or null | `null` | `request.time` of the last hand-in |
| `lastHandinId` | string | `''` | id of the last hand-in |

- **Who writes it**:
  - Only the student creates it, with doc id = own uid, while the class accepts hand-ins.
  - The student updates it in two ways only: the counter tick (§2.9), and a **rename**
    (`affectedKeys` ⊆ `firstName, lastName, nameKey`, same validation). A rename and a
    tick in one batch are refused. The counter and the cooldown survive a rename.
  - The teacher lists, reads and deletes members. Students cannot delete theirs: it
    carries the cooldown and the counter.
- **The 300 cap is best effort per identity** (two concurrent batches at 299 can both
  land). "Change" keeps the uid, so it does not reset the count; a wiped browser does.
- Old hand-ins keep the name they were made under (denormalised, §2.8): after a rename
  the teacher sees two students, which is right when two students shared a computer.

### 2.8 `classes/{code}/handins/{handinId}`

| field | type | rule |
|---|---|---|
| `uid` | string | `== request.auth.uid` |
| `firstName`, `lastName`, `nameKey` | string | `==` the member doc's values **after the batch** (denormalised snapshot; `getAfter(members/{uid})`) |
| `ownerUid` | string | `== class.ownerUid` |
| `kind` | string | `'code'`, `'blocks'` or `'python'` |
| `createdAt` | timestamp | `== request.time`, immutable |
| `enc` | string | `'plain'` or `'gzip'` |
| `code` | string or bytes | the Arduino sketch (Blocks: generated from the blocks; Python: made from the program, or the placeholder sketch when the program has errors, docs/PYTHON.md §4.10 T9). `plain`: string ≤ 50,000 UTF-8 bytes. `gzip`: bytes ≤ 50,000. Never empty |
| `workspace` | string or bytes | Blocks: `JSON.stringify(Blockly.serialization.workspaces.save(ws))`, never empty. Python: the Python source, never empty (the client stops at 50,000 bytes, `LIMITS.pythonMaxBytes`). Code: empty. `plain`: ≤ 100,000 UTF-8 bytes. `gzip`: ≤ 100,000 bytes |

- **Encoding** (`src/classroom/codec.ts`), unchanged: gzip when `CompressionStream`
  exists and it is smaller, else plain; the client checks the raw sizes before
  encoding; decoding is capped at 2× (gzip bombs → `too_large`).
- The workspace is a string, not a map (nesting limit, opaque to indexing).
- **Python hand-ins reuse `workspace`** (docs/PYTHON.md §8.1): the same 10 keys, no new
  field, index or codec change. `student.ts` writes `workspace = kind === 'python' ?
  draft.python : draft.workspaceJson`; readers call `contentOf(kind, decoded)`, which puts
  the stored workspace under `workspaceJson` (Blocks) or `python` (Python). Every reader
  checks `kind === 'blocks'` before reading the workspace as Blockly JSON, and
  `readHandinDoc` reads an unknown kind as `'code'` (its sketch), so an older dashboard
  shows a Python hand-in's sketch.
- **Immutable**: nobody updates a hand-in, not even the owner (no re-filing: there is no
  roster to re-file to). The owner deletes.

### 2.9 The hand-in batch and idempotent retry (MUST)

The id is made **before** the batch with `newHandinId()` (20 × `[A-Za-z0-9]`, crypto
random), and the dialog keeps it for retries of the same draft.

```ts
const batch = writeBatch(db);
batch.set(doc(db, `classes/${code}/handins/${id}`), {
  uid, firstName, lastName, nameKey, ownerUid, kind,
  createdAt: serverTimestamp(), enc, code, workspace,            // code/workspace: Bytes.fromUint8Array(...) when enc === 'gzip'
});
batch.update(doc(db, `classes/${code}/members/${uid}`), {
  handinCount: increment(1), lastHandinAt: serverTimestamp(), lastHandinId: id,
});
await withTimeout(batch.commit());
```

How the rules tie the two writes together:
- The hand-in requires the member doc *after* the batch to have `lastHandinId == id`,
  `lastHandinAt == request.time` and the same `firstName` / `lastName` / `nameKey`.
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
| rename class / hand-ins switch / keepWeeks | teacher | `updateDoc` | 0 | 1 |
| remove computer | teacher | `deleteDoc(members/uid)` | 0 | 1 delete |
| find class | student | `getDoc(class)` + `getDoc(members/me)` | 2 | 0 |
| enter a name (join) | student | `setDoc(members/me)`, or `updateDoc` of the three name fields when the doc exists (no write when the name is the same) | 1 (rule get) / 0 | 1 |
| restore (dialog open) | student | `getDoc(class)` | 1 | 0 |
| hand in | student | 1 batch (§2.9) | ≤ 3 (rules: class, member-after, hand-in-after) | 2 |
| check after timeout / diagnosis | student | `getDoc(members/me)` (+ `getDoc(class)`) | 1-2 | 0 |
| delete hand-in | teacher | `deleteDoc` | 0 | 1 delete |
| prune | teacher | count + `where createdAt < cutoff orderBy createdAt limit 200` → batch | 1 + n | n deletes |
| download everything / old hand-ins | teacher | `loadHandins` pages of 100 until `hasMore` is false | n | 0 |
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
2. `updateDoc(class, { deleting: true, handinsOpen: false, updatedAt })`.
   From then on no new name and no hand-in succeeds.
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
| teacher | `members orderBy joinedAt desc limit 150` (live while a detail panel is shown) | automatic single-field |
| teacher | `handins where createdAt >= startOfToday orderBy createdAt desc limit 300` (live) | automatic single-field (`createdAt`) |
| teacher | `handins where createdAt >= since orderBy createdAt desc limit 100` (+ `startAfter`) | automatic single-field |
| teacher | `handins where nameKey == key orderBy createdAt desc limit 10` (older versions) | **composite** (nameKey ↑, createdAt ↓) |
| teacher | `handins where createdAt < cutoff orderBy createdAt limit 200`, and `count()` | automatic single-field |
| student | `handins where uid == me orderBy createdAt desc` (allowed by the rules; not used by the dialog any more) | **composite** (uid ↑, createdAt ↓) |

`firestore.indexes.json` (MUST, deployed with the rules) holds the two composite indexes
and turns off single-field indexing for every field that is never queried on its own:
hand-ins `uid`, `nameKey`, `firstName`, `lastName`, `ownerUid`, `kind`, `enc`, `code`,
`workspace`; members `firstName`, `lastName`, `nameKey`, `ownerUid`, `device`,
`handinCount`, `lastHandinId`; classes `name`, `keepWeeks`, `schema`. The file is the
source of truth. Python hand-ins changed nothing here: their program is in the exempt
`workspace` field.

- This saves about half of each hand-in's stored size, since index entries count
  toward the 1 GiB (§6.2).
- **The emulator does not check composite indexes.** Tests pass without them.
  Therefore there is **no silent fallback**: `failed-precondition` on the composite
  queries becomes `index_missing`, and the data layer logs `console.error` with the
  index link once; step 7 of §6.1 is mandatory; step 11 (the production smoke test)
  runs the `nameKey` query.
- **Rules are not filters.** Every query MUST carry the constraint the rule checks:
  `ownerUid == uid` for classes, `uid == me` for a student's hand-ins.
  Collection-group queries are denied.

### 2.13 Browser storage

| key | where | owner | content |
|---|---|---|---|
| `z1.classroom` | localStorage | session-store | `{"v":2,"code","className","firstName","lastName","uid","lastUsedAt","lastHandinAt"}` (a `v: 1` entry from before the simplification is ignored) |
| `z1.classroom.lastCode` | localStorage | session-store | the last class code (prefill after Change) |
| `z1.teacher.lastClass` | localStorage | dashboard | last opened class code |
| `z1.teacher.period.<code>` | localStorage | dashboard | `today` / `7` / `14` / `30` |
| `z1.teacher.seen.<code>` | localStorage | dashboard | `{ nameKey: createdAtMs }` |
| `z1.teacher.pruned.<code>` | sessionStorage | dashboard | retention already checked in this tab |
| `z1.review.<rid>` | localStorage | dashboard → review page | large review payloads (§1.4). Cleared on sign-out and `pagehide`; the review page drops entries older than 1 day |
| IndexedDB `firebaseLocalStorageDb` | | Firebase Auth | anonymous student session (app `z1-student`) **only**. The teacher session is in the tab's sessionStorage |
| removed | | B | `z1.teacherEmail`, `z1.studentName` (legacy relay keys, deleted once at start-up) |

Every access is wrapped in try/catch, as in the rest of the app. The simulator in the
sandboxed review frame has **no** storage: every accessor throws `SecurityError` there,
and the app must keep working (it does, verified).

---

## 3. Security

### 3.1 `firestore.rules` (MUST; tested as-is, §7.1)

The file at the repository root is the source of truth (the rules of the roster model in
the earlier version of this document were replaced on 2026-09-27). What it enforces:

- **Teachers** are `google.com` sign-ins with `email_verified == true`; students are
  anonymous. Every write is checked field by field (`exactKeys` on create,
  `affectedKeys().hasOnly` on update). Request-only checks come first, document reads
  (`get` / `getAfter`, each a billed read even when denied) last.
- **classes/{code}**: `get` for anyone signed in; `list` only with `ownerUid == uid`;
  create/update/delete by the owner with the shape of §2.3 (`schema == 2`, server
  times, `deleting == false` at create). Deleting a missing doc is allowed to a teacher.
- **members/{uid}**: `get` own or owner; `list` owner; **create** by the uid itself with
  `validMemberShape` (§2.7: `validName` on both names, lower-case `nameKey` ≤ 61,
  `ownerUid` a string, `joinedAt == request.time`, device ≤ 40, counter at 0) and
  `validMemberClass` (class not deleting, `handinsOpen`, `ownerUid == class.ownerUid`);
  **update** by the uid itself as either a **rename** (`affectedKeys` ⊆ the three name
  fields, same validation) or the **tick** (`handinCount + 1` ≤ 300, `lastHandinAt ==
  request.time` at least 10 s after the previous one, `lastHandinId` a 20-char id whose
  hand-in *after the batch* has this uid and `createdAt == request.time`); **delete** by
  the owner.
- **handins/{hid}**: `get`/`list` by the owner or by the student for `uid == me`;
  **create** with `validHandinShape` (§2.8: `uid == auth.uid`, name strings,
  `kind in ['code', 'blocks', 'python']`, `createdAt == request.time`, `validContent`:
  `enc` matching the field types, the sizes, a non-empty sketch, and
  `(d.kind == 'code' ? d.workspace.size() == 0 : d.workspace.size() > 0)`, so Blocks and
  Python hand-ins carry their workspace or program) and `validHandinClass` (class open and
  not deleting, `ownerUid == class.ownerUid`, the three name fields equal to the member
  doc's *after the batch*, and that member doc's `lastHandinId == hid` and
  `lastHandinAt == request.time`); **no update** for anyone; **delete** by the owner.
- Everything else, including collection-group queries, is closed.

The name regex is `"^\\p{L}[\\p{L} '.-]{0,29}$"` (RE2; the same as `NAME_PATTERN` in
`model.ts`, checked by `tests/classroom-model.test.ts` together with every limit).

**Python hand-ins (2026-09-29, docs/PYTHON.md §8.2)** changed two clauses: `kind` may be
`'python'`, and only a Code hand-in has an empty workspace. The change is backward
compatible (every Code and Blocks hand-in passes as before). Publish the rules
(`npx firebase-tools@15.31.0 deploy --only firestore:rules`) **before** the site that
offers Python hand-ins (docs/PYTHON.md §11.4): until then the old rules refuse them with
`permission-denied`.

### 3.2 Notes for Dev A

- **Billing of rule reads.** `get()`, `exists()`, `getAfter()` and `existsAfter()` each
  count as a **billed read**, once per document per request, **also when the request is
  denied**.
  - Access-call limits: 10 per single-document request or query; 20 per batch or
    transaction; 10 per operation.
  - The hand-in batch uses 3 calls on 3 distinct documents. Teacher deletes use none.
- **Order of checks.** Conditions check the request alone first and read documents
  last. Rules short-circuit `&&` and `||`, so a malformed request costs no read.
- **Sizes.** `string.size()` counts characters. The client cuts names by UTF-16 length
  (`.length`), which is never smaller, so a value the client accepts always passes. Content limits are in UTF-8 bytes on both sides
  (`new TextEncoder().encode(s).length` ↔ `toUtf8().size()`), or in bytes for gzip.
- **Teachers** must be `google.com` sign-ins with `email_verified == true`.
  - A token with no `email_verified` claim is denied: safe direction, and rare for
    Google.
  - Other providers and smuggled claims are denied (R1.2).
  - To restrict teachers to some schools later, extend `isTeacher()` with an email-domain
    regex (see the comment in the rules).
  - Microsoft sign-in later = `sign_in_provider in ['google.com', 'microsoft.com']`.
- **`lower()` is ASCII-only** in the emulator (and documented as such): the rules do
  not check the `nameKey` formula, only that the key is lower-case-stable (§2.4).

### 3.3 Threats and how the rules stop them

| threat | stopped by | tests |
|---|---|---|
| reading another teacher's class list | `list` only with `ownerUid == auth.uid` (the query must say so) | R3.3 |
| reading another teacher's members or hand-ins | members `list` = `ownsClass` (a get of the class); hand-ins `list` = own uid or `ownsClass`; single gets check the copied `ownerUid` | R5.2, R7.4 |
| a student reading other students' hand-ins | hand-ins readable only when `uid == auth.uid` | R7.1 |
| handing in without a member doc, or under a name other than the member doc's | the three name fields must equal the member doc's *after the batch*; member docs are bound to the uid | R6.5, R4.5 |
| cross-class hand-in, batch cross-wiring, re-using an old hand-in for the tick, a rename in the same batch | member path is the same class; tick bound to a hand-in created by *this* request; rename and tick are exclusive | R6.4, R6.5, R4.10, R6.13, R6.15 |
| forging `createdAt`, `uid`, `ownerUid`, the class | `createdAt == request.time`; `uid == auth.uid`; `ownerUid == class.ownerUid`; the class is the path | R6.6 |
| editing or deleting a hand-in after submission | no update for anyone; delete by the owner only | R7.2 |
| invalid names (digits, HTML, empty, over 30) | `validName` regex on create and rename | R4.2, R4.8 |
| a student changing anything but their name, or another student's doc | `validRename` (`affectedKeys` ⊆ the three name fields), own uid only | R4.8 |
| class tampering by students | class `update` is owner-only | R3.10 |
| entering or handing in to a stopped / deleting class | `handinsOpen == true`, `deleting == false` | R4.4, R6.14 |
| enumerating classes through list queries | no `list` on classes except own; no collection-group rules | R3.3, R7.5 |
| oversize documents | every string capped; content capped in UTF-8 bytes or gzip bytes | R6.8, R6.18 |
| a hand-in whose workspace does not fit its kind (a Code hand-in carrying data, a Blocks or Python hand-in without its workspace or program, an unknown kind) | `kind in ['code', 'blocks', 'python']`; the workspace is empty exactly for Code | R6.6, R6.9, R6.18 |
| wrong encoding / gzip bombs | `enc` must match the field types; the dashboard inflates with a cap | R6.3, e2e |
| unexpected fields (including the old roster / task fields) | `exactKeys` on every create; `affectedKeys().hasOnly` on every update | R1.5, R3.5, R4.6, R6.6 |
| hand-in flooding from one identity | 10 s cooldown + 300 per device in the member tick (best effort, §2.7) | R6.10, R6.11 |
| anonymous users acting as teachers | `isTeacher()` requires `google.com` + verified email | R1.2 |
| a failed or duplicated delete batch | deleting a missing doc is allowed | R3.11, R5.3, R7.7 |
| writing anywhere else | no other `match` | R8.2 |

`tests-emulator/mutations.sh` weakens the rules one clause at a time (11 mutations) and
checks that the suite catches each one.

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
never `innerHTML`. That covers `firstName`, `lastName`, `device`, class `name` and the
code `<pre>`. It applies to the dashboard, the review
banner and the student dialog. §7.3 has a test matrix with stored `<img src=x
onerror=…>` and `</script>` payloads (R4.7 shows the rules accept them).

### 3.5 What the rules cannot stop

1. **Anyone with the code can hand in under any name** while the class accepts hand-ins.
   This is accepted by the teacher's decision of 2026-09-27 (simplicity over control):
   the code is the only secret. They still cannot read that student's earlier hand-ins.
   - Mitigations: the code is shown in class and not published; "Hand-ins stopped" for
     old classes; the teacher sees the device of every hand-in, "2 computers within an
     hour", and can delete a hand-in or remove a computer.
2. **Shared computers.** The next person at a computer sees the previous student's name
   in the header and on the Ready view ("Hand in as Ali Khoury…") and must press
   **Change** to type their own. A careless student hands in under the wrong name; the
   teacher deletes it and the student hands in again.
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
5. **Content.** The rules cannot judge code or names (rudeness, personal data). The
   teacher deletes.
6. **Visible to anyone with the code**: the class name and the teacher's Firebase
   `ownerUid` (R3.2). Student names are visible only to the teacher and to the device
   that typed them.
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
   - in the console, set that class's `handinsOpen: false` (the teacher can do it too);
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
export const CLASS_SCHEMA = 2;
export const LIMITS = {
  classNameMax: 60, nameMax: 30, deviceMax: 40,
  codeMaxBytes: 50_000, workspaceMaxBytes: 100_000,
  pythonMaxBytes: 50_000,                                 // client-only: the rules check workspace ≤ 100,000
  codeDecodeCap: 100_000, workspaceDecodeCap: 200_000,   // 2× the raw limits
  handinsPerDevice: 300, handinCooldownMs: 10_000, clockSkewMs: 60_000,
  keepWeeksMin: 1, keepWeeksMax: 52,
  requestTimeoutMs: 20_000, batchMaxOps: 400, deletesPerRun: 5_000, prunePerOpen: 500,
  todayLimit: 300, periodPage: 100, studentPage: 10, membersWatchLimit: 150, reviewHashMax: 60_000,
} as const;
export const NAME_PATTERN = /^\p{L}[\p{L} '.-]{0,29}$/u;

export function normalizeClassCode(input: string): string | null;       // 'bkt-4m9 ' → 'BKT4M9'; '8KT' → 'BKT'…
export function codeProblem(input: string): string | null;              // 'Class codes never contain the letter A.'
export function formatClassCode(code: string): string;                  // 'BKT4M9' → 'BKT-4M9'
export function classLink(code: string, base?: string): string;         // new URL('./#class=BKT4M9', base ?? location.href)
export function generateClassCode(randomBytes?: (n: number) => Uint8Array): string;
export function newHandinId(randomBytes?: (n: number) => Uint8Array): string; // 20 × [A-Za-z0-9], rejection sampling
export function isHandinId(id: string): boolean;

export function cleanName(input: string): string;                       // NFC, one line, ≤ 30
export type NameProblem = 'empty' | 'too_long' | 'invalid';
export function nameProblem(name: string): NameProblem | null;
export function nameKeyOf(firstName: string, lastName: string): string; // 'ali khoury'
export function fullName(firstName: string, lastName: string): string;  // 'Ali Khoury'
export function listName(firstName: string, lastName: string): string;  // 'Khoury, Ali'

export function cleanLine(text: string, max: number): string;       // one line; invisible chars removed; trimmed; cut (no half surrogate)
export function utf8Length(text: string): number;
export function deviceLabel(userAgent: string): string;             // 'Chrome · Windows' (≤ 40)
export function shortDeviceId(uid: string): string;                 // last 4 chars, uppercase

export type HandinKind = 'code' | 'blocks' | 'python';
export interface HandinDraft { kind: HandinKind; code: string; workspaceJson: string; python: string }   // '' when not that kind
export interface HandinContent { kind: HandinKind; code: string; workspaceJson: string; python: string }
export interface HandinRecord {
  id: string; classCode: string; uid: string; firstName: string; lastName: string; nameKey: string;
  kind: HandinKind; createdAt: Date | null; content: EncodedContent;
}
export function draftProblem(draft: HandinDraft): 'empty_sketch' | 'too_large' | null;   // Python: no program → empty_sketch; > pythonMaxBytes → too_large
/** The decoded workspace under the field of its kind: workspaceJson (Blocks), python (Python), neither (Code). */
export function contentOf(kind: HandinKind, decoded: { code: string; workspaceJson: string }): HandinContent;

export interface ClassDoc { ownerUid; name; handinsOpen; keepWeeks; deleting; createdAt; updatedAt }
export interface MemberDoc { firstName; lastName; nameKey; device; joinedAt; handinCount; lastHandinAt; lastHandinId }
export function readClassDoc(data): ClassDoc; export function readMemberDoc(data): MemberDoc;
export function readHandinDoc(id, classCode, data): HandinRecord;   // Bytes → Uint8Array; a kind other than code/blocks/python → 'code'
```

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
(`Bytes.fromUint8Array` / `.toUint8Array()`). The codec knows no kinds: a Python program
travels as its `workspaceJson` argument and result (§2.8, `contentOf`).

### 4.6 `src/classroom/errors.ts` and `session-store.ts`

```ts
export type ClassroomErrorCode =
  | 'not_configured' | 'load_failed' | 'app_updated' | 'offline' | 'timeout' | 'quota' | 'signup_limit'
  | 'auth_disabled' | 'storage_blocked' | 'popup_blocked' | 'popup_closed' | 'unauthorized_domain'
  | 'recent_login' | 'not_ready' | 'index_missing' | 'bad_code' | 'class_not_found'
  | 'handins_closed' | 'class_deleted' | 'lost_identity' | 'device_removed' | 'too_soon'
  | 'limit_reached' | 'empty_sketch' | 'too_large' | 'code_collision' | 'bad_name' | 'classes_left'
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
export interface SavedSession {
  v: 2; code: string; className: string; firstName: string; lastName: string; uid: string;
  lastUsedAt: number;        // ms since epoch
  lastHandinAt: number;      // 0 = never
}
export function loadSavedSession(storage?: Storage): SavedSession | null;   // null on bad JSON / an older version / a wrong shape / a throwing storage
export function saveSession(session: SavedSession, storage?: Storage): void; // swallows storage errors
export function clearSession(storage?: Storage): void;
export function loadLastCode(storage?: Storage): string;
export function saveLastCode(code: string, storage?: Storage): void;
/** "Ali Khoury", '' when none: header label and .ino file names (Share, Arduino IDE dialog). */
export function currentStudentName(storage?: Storage): string;
```

### 4.7 `src/classroom/student.ts` (StudentApi)

```ts
export interface StudentSession { code: string; className: string; firstName: string; lastName: string; uid: string }
export interface PublicClass { code: string; name: string; ownerUid: string; handinsOpen: boolean }
export interface StudentName { firstName: string; lastName: string }
export interface FoundClass { info: PublicClass; existing: StudentName | null }   // existing = this device's member doc
export interface RestoreResult { session: StudentSession; info: PublicClass; lastHandinAt: number | null }

export interface StudentApi {
  /**
   * The saved session, checked: the same anonymous uid (else 'lost_identity': session cleared, lastCode kept);
   * the class exists, is not deleting and accepts hand-ins (1 read); the class name is refreshed. The member
   * doc is NOT read here. Null when nothing is saved: no Firebase download then.
   * Rejects: lost_identity | class_deleted | handins_closed | offline | timeout | quota | load_failed | app_updated.
   */
  restore(): Promise<RestoreResult | null>;
  /** Normalise → sign in anonymously if needed → get the class + own member doc (2 reads). */
  findClass(codeInput: string): Promise<FoundClass>;
  /**
   * cleanName + nameProblem (else 'bad_name'), then setDoc(members/me) or, when found.existing, updateDoc of the
   * three name fields (nothing when the name is the same). A denied write is retried the other way once (the doc
   * appeared or vanished meanwhile), then explained with a fresh read of the class. Saves the session + lastCode.
   * Rejects: bad_name | handins_closed | class_not_found | offline | timeout | quota | permission.
   */
  join(found: FoundClass, name: StudentName): Promise<StudentSession>;
  /**
   * As before (§2.9): local checks → the 2-write batch → on failure read the member doc, then diagnose.
   * The stored workspace is draft.python for a Python hand-in, else draft.workspaceJson (§2.8).
   */
  handIn(session: StudentSession, draft: HandinDraft, handinId: string): Promise<HandinRecord>;
  /** "Change": forget the saved session; the anonymous uid stays (the member doc is renamed next time). */
  forget(options?: { forgetCode?: boolean }): void;
}
export interface StudentApiDeps { load?; storage?; now?; userAgent?; timeoutMs? }
export function createStudentApi(deps?: StudentApiDeps): StudentApi;
export function cleanStudentName(name: StudentName): StudentName | null;

/** Pure: why a hand-in was refused, from fresh reads. 'renamed' = the member doc's name differs from the session. */
export function diagnoseHandinRefusal(
  cls: { deleting: boolean; handinsOpen: boolean } | null,
  member: { firstName: string; lastName: string; handinCount: number; lastHandinAt: Date | null; lastHandinId: string } | null,
  session: StudentName, handinId: string, now: number,
): ClassroomErrorCode | 'renamed' | 'arrived';
```

Diagnosis order: `arrived` (member `lastHandinId === handinId`) → `class_deleted` →
`handins_closed` → `device_removed` (member missing) → `limit_reached` → `too_soon`
(+1 s margin) → `renamed` (retried once with the member doc's name and the same id) →
`permission`.

`myHandins` and `leave` (delete the anonymous user) are gone: the dialog has no history
and "Change" keeps the uid.

### 4.8 `src/classroom/teacher.ts` (TeacherApi)

```ts
export type Unsubscribe = () => void;
export interface TeacherUser { uid: string; name: string; email: string; photoURL: string | null }
export interface ClassSummary { code: string; name: string; handinsOpen: boolean; deleting: boolean; createdAt: Date | null; updatedAt: Date | null }
export interface ClassDetail extends ClassSummary { ownerUid: string; keepWeeks: number }
export interface Member {
  uid: string; firstName: string; lastName: string; nameKey: string; device: string;
  joinedAt: Date | null; handinCount: number; lastHandinAt: Date | null;
}
export interface HandinsUpdate { items: HandinRecord[]; added: string[]; modified: string[]; removed: string[] }
export interface NewClassInput { name: string; keepWeeks?: number }
export type ClassPatch = Partial<Pick<ClassDetail, 'name' | 'handinsOpen' | 'keepWeeks'>>;

export interface TeacherApi {
  readonly ready: Promise<void>;
  onUser(callback: (user: TeacherUser | null) => void): Unsubscribe;   // a non-Google user is signed out
  signIn(): Promise<TeacherUser>;     // MUST be called synchronously in the click handler, after `ready`
  signOut(): Promise<void>;

  watchClasses(onChange, onError): Unsubscribe;
  createClass(input: NewClassInput): Promise<ClassDetail>;             // transaction with up to 5 code attempts
  watchClass(code, onChange: (cls: ClassDetail | null) => void, onError): Unsubscribe;
  updateClass(code: string, patch: ClassPatch): Promise<void>;

  watchMembers(code, onChange: (members: Member[]) => void, onError): Unsubscribe;   // newest 150
  removeDevice(code: string, uid: string): Promise<void>;
  removeUnusedDevices(code: string, olderThanDays: number): Promise<number>;

  watchTodayHandins(code, onChange: (u: HandinsUpdate) => void, onError): Unsubscribe;   // since local midnight, live, ≤ 300
  loadHandins(code: string, since: Date, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>;  // 100 per page
  studentHandins(code: string, nameKey: string, page?: { before?: Date }): Promise<{ items: HandinRecord[]; hasMore: boolean }>; // 10 per page; composite index
  deleteHandin(code: string, id: string): Promise<void>;

  countHandinsBefore(code: string, before: Date): Promise<number>;
  pruneHandins(code: string, before: Date, maxDeletes?: number): Promise<number>;
  deleteClass(code: string, onProgress?, budget?): Promise<'done' | 'more'>;     // §2.11
  deleteAllClasses(onProgress?): Promise<'done' | 'more'>;
  deleteAccount(): Promise<void>;     // step 2 of T12; synchronous in the click
}
export function createTeacherApi(deps?: { load?; randomBytes?; now?; reauthenticate? }): TeacherApi;   // starts loading at once
```

Gone with the roster and the tasks: `openJoinWindow`, `closeJoining`, `letRejoin`,
`addStudents`, `renameStudent`, `removeStudent`, `addTasks`, `renameTask`, `deleteTask`,
`refileHandin`. All methods reject with `ClassroomError`; every network call goes
through `withTimeout`; deletes are idempotent (§2.11).

### 4.9 `src/share-link.ts` (pure; A)

Move these from `editor.ts` / `blocks-panel.ts` without changing behaviour:
`encodeShareCode`, `decodeShareCode`, `codeFromHash`, `encodeShareBlocks`,
`blocksFromHash`, `parseWorkspaceJson`. Then add:

```ts
/** '#class=BKT4M9' → 'BKT4M9' (normalised) or null. */
export function classFromHash(hash: string): string | null;
/** '#python=' links (docs/PYTHON.md §8.4): the same base64url UTF-8 encoding as '#code='. */
export function encodeSharePython(source: string): string;
export function pythonFromHash(hash: string): string | null;
export interface ReviewPayload {
  v: 1; kind: HandinKind; code: string; workspaceJson: string;
  python?: string;                                                            // the program of a Python hand-in; absent in older links → ''
  who: string; className: string; task: string; title: string; at: number;   // at = createdAt ms
}
export function encodeReviewPayload(p: ReviewPayload): string;          // base64url(UTF-8 JSON)
export function decodeReviewPayload(s: string): ReviewPayload | null;   // strict shape check
/** The review link: #review= when ≤ LIMITS.reviewHashMax, else #rid= plus a localStorage handoff. */
export function reviewLink(p: ReviewPayload, base?: string): { href: string; handoff: { key: string; value: string } | null };
/**
 * For the student's own history: '#code=…', '#blocks=…' or '#python=…' (the #code= link when a Blocks workspace is
 * not a JSON object or a Python hand-in has no program).
 */
export function handinHash(content: { kind: HandinKind; code: string; workspaceJson: string; python?: string }): { hash: string; fellBack: boolean };
```

`editor.ts` and `blocks-panel.ts` re-export the moved names (B), so existing imports and
tests keep working.

### 4.10 Hand in dialog (`src/ui/handin-dialog.ts`, B)

```ts
export interface HandinWork {
  kind: HandinKind; code: string; workspaceJson: string;
  python: string;                                                            // the Python program; '' unless kind is 'python'
  unchanged: { kind: 'blank' } | { kind: 'example'; title: string } | null;   // set by the App (blank sketch / BLANK_PYTHON, untouched example)
  errorCount: number;                                                        // synchronous transpile(); Python: the Python errors
}
export interface HandinDialogOptions {
  loadApi?: () => Promise<StudentApi>;       // default: () => import('../classroom/student').then((m) => m.createStudentApi())
  onSessionChange?(studentName: string): void; // App updates the header label ('' = no remembered name)
  toast?(text: string): void;
  onAppUpdated?(): void;
  confirm?(text: string): boolean;           // default window.confirm (the untouched-example question)
  now?: () => Date;
  isOnline?: () => boolean;
}
export interface HandinDialog {
  open(work: HandinWork, options?: { joinCode?: string }): void;  // joinCode: a #class= link prefills the code (S0)
  close(): void; isOpen(): boolean; readonly element: HTMLDialogElement;
}
export function createHandinDialog(parent: HTMLElement, options?: HandinDialogOptions): HandinDialog;
export const HANDIN_TEXT: {
  title, loading, nameHelp, handingIn, checking, notArrived, blank, example(title), errors(n), success(time),
  pythonWork, pythonBlank, pythonErrors(n), pythonEmpty, pythonNotReady,   // Python hand-ins (docs/PYTHON.md §8.3)
};
```

- A `<dialog class="z1-dialog z1-handin">`, built like Share and the Arduino IDE dialog.
- One view is visible at a time: `data-view="loading|code|name|ready|success|error"`.
  The work block (description, warnings) moves into the Name and Ready views.
- Buttons carry `data-action`: `next`, `back`, `handin-name`, `handin`, `retry`,
  `change`, `different`, `ok`, `retry-open`, `close`. Texts carry `data-role`.
- Focus: Code view → the code input; Name → First name; Ready → Hand in; Success →
  Close; after an error → the control to fix.
- The dialog never keeps the student's work after closing; `open(work)` replaces it.
- All user strings go through `textContent`.
- **Python** (docs/PYTHON.md §8.3): the draft is `{ kind: 'python', code, workspaceJson: '',
  python }`. The work line is `pythonWork`; the untouched-blank question `pythonBlank`; the
  errors note `pythonErrors(n)` with `n = placeholderErrorCount(code) ?? errorCount` (the
  placeholder sketch carries the count, `src/sketch/placeholder.ts`); an empty program is
  refused with `pythonEmpty`; a `permission` answer to the hand-in shows `pythonNotReady`
  ("Your class is not ready for Python hand-ins yet: ask your teacher to update the class
  rules.", for a site deployed before the rules, docs/PYTHON.md §11.4).

### 4.11 `src/ui/app.ts` changes (B)

**Header.**
- The button: `<button type="button" class="z1-btn" data-slot="handin" aria-label="Hand in your work to your teacher" title="Hand in: send this work to your teacher"><span aria-hidden="true">📥</span> <span class="z1-handin-label">Hand in</span><span class="z1-handin-name"></span></button>`.
- It is rendered only when `isClassroomConfigured()`.
- Order: New, Examples, Run, Stop, Reset, Settings, **Hand in**, Share, Arduino IDE.
- While a name is remembered, the name part is " · Ali Khoury" with `max-width: 14ch;
  overflow: hidden; text-overflow: ellipsis`. The `aria-label` becomes "Hand in as Ali
  Khoury to your class".
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
  when configured calls `handinDialog.open(work, { joinCode })` (the code is prefilled).
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
- Download names use `currentStudentName()` ("Ali Khoury" → `zero1_Ali_Khoury_…`).
- `ShareDialogOptions` keeps `copyText`, `toast` and `download`, and drops `relayUrl`
  and `sendWork`.
- **Arduino IDE dialog**: the default `studentName()` becomes `currentStudentName()`.

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
    Today), plus `watchMembers` while a detail panel is shown (device labels).
  - Switching class keeps the previous class's listeners for **10 minutes** (at most
    one previous class). Re-subscribing with the memory cache re-bills every document.
- **Decoding**: the content of each loaded record is decoded (`decodeContent`) right
  after it arrives and cached by id in memory. Open links, `.ino` and Copy are enabled
  only once it is decoded, so there is **no `await` between a click and the action**
  (M3).
- **Open links**:
  - `reviewLink(payload)` gives the `href`;
  - when it returns a `handoff`, the dashboard writes it to `localStorage` **when it
    first renders** the link (so middle-click works too), memoises the link per hand-in
    and class name on the `ClassSession` (one entry per record, not one per render),
    and removes its handoffs on `pagehide` and sign-out.
  - There is no "Opened in a new tab" toast.
- **Zip** (`src/teacher/zip.ts`):
  - `makeZip(files: { name: string; data: string | Uint8Array; date?: Date }[]): Blob`;
  - store-only (no compression), CRC-32, UTF-8 file names (flag bit 11);
  - names `<First_Last>.ino`, `<First_Last>.blocks.json` (Blocks), `<First_Last>.py`
    (Python, docs/PYTHON.md §8.5), `<First_Last>-<yyyy-mm-dd-hhmm>.ino` (and `.blocks.json`
    / `.py`) for older versions. The files of one hand-in share one stem, made unique
    (`-2`, `-3`), so a `.py` keeps its `.ino`'s name. A Python hand-in with errors keeps
    its placeholder `.ino` in the zip (two comment lines that say so).
- **Python hand-ins** (docs/PYTHON.md §8.5): every reader turns the decoded content into
  `contentOf(record.kind, decoded)` (the program is in the stored workspace, §2.8); the kind
  label is "Python" (`z1t-kind-python`) in the Overview, the detail and the feed; the detail
  card, the Overview **.ino** and the review payload (`reviewPayloadFor()` carries `python`)
  follow T6 and §1.4.
- **Complete downloads**: "Download everything first" (Settings) and "Download them"
  (the retention notice) page through every hand-in with `ClassSession.loadAll()` (no
  cap) and report the count; a failed page shows the error, never a silently short zip.
- **Allowed imports**: `src/classroom/model.ts`, `codec.ts`, `errors.ts`,
  `teacher.ts` (type imports plus the lazy import), `src/share-link.ts`,
  `src/ui/sketch-file.ts`, `src/sketch/placeholder.ts` (`placeholderErrorCount`; it imports
  nothing). Anything that imports CodeMirror, Blockly, the transpiler or
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
- The page imports only `src/share-link.ts`, `src/ui/sketch-file.ts`,
  `src/sketch/placeholder.ts` and its own CSS.
- **Python** (docs/PYTHON.md §8.5): "· Python" in the banner, **Download .py**
  (`pythonFileName`) next to **Download .ino**, **Copy code** copies the program; a program
  handed in with errors adds "Handed in with {N} Python errors" and disables
  **Download .ino** (§1.4). The frame's Python review mode is the simulator's
  (docs/PYTHON.md §7.13); until then it shows the handed-in sketch in Code mode.

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
    1. Open `…/teacher.html`, sign in, create a class.
    2. In a private window, open the class link, type a name and hand in. The hand-in
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

64 cases against the Firestore emulator (`npm run test:rules`), with the contexts
`teacher(uid)` (google.com, verified email), `student(uid)` (anonymous) and `nobody()`;
seeding with `withSecurityRulesDisabled`, `clearFirestore()` before each test.

- **R1 classes, create.** R1.1 happy path; R1.2 teacher gate (anonymous, unverified, no
  claim, other providers, smuggled claims, signed out ✗); R1.3 foreign ownerUid ✗; R1.4
  bad codes ✗; R1.5 extra / missing field, client times, `deleting: true`, `schema: 1`,
  the old roster fields ✗; R1.6 name length, switch type, `keepWeeks` 0 / 53 / 10.5 /
  "10" ✗; R1.7 re-create over an existing class ✗.
- **R3 classes, read / update / delete.** R3.1 get by code ✓ (also missing), signed out
  ✗; R3.2 the GET exposes `ownerUid` and the name, no email; R3.3 list own with the
  filter only; R3.4 the owner edits name, switch, retention; R3.5 immutable and extra
  fields (roster too), missing `updatedAt`, empty name ✗; R3.10 others ✗, owner deletes;
  R3.11 deleting a missing class: teacher ✓, student ✗.
- **R4 members, enter a name.** R4.1 anyone with the code, also the same name twice;
  R4.2 the name regex (accents, Arabic, `O'Neil-Dupont Jr.`, 30 chars ✓; empty, 31,
  digits, leading hyphen, HTML, newline, non-string ✗); R4.3 nameKey (upper-case,
  empty, 62 chars, non-string ✗); R4.4 stopped / deleting / missing class ✗; R4.5 own
  doc only, `ownerUid` must be the class owner; R4.6 forged counter, time, long device,
  extra or missing field, the old `studentId`/`username` ✗; R4.7 HTML device label
  stored; **R4.8 "Change"**: the owner uid renames (three fields, same validation, the
  counter stays; a single field, an upper-case key, a bad name, other fields, another
  uid, the teacher ✗); R4.9 re-create ✗, a tick without a hand-in ✗; R4.10 a tick against
  an **old** own hand-in ✗.
- **R5 members, read / remove.** R5.1 own only; R5.2 the owner lists and deletes,
  others ✗; R5.3 a double delete batch ✓.
- **R6 hand-ins, create.** R6.1 batch with `increment(1)` ✓; R6.2 plain blocks, gzip
  code, gzip blocks ✓; R6.3 encoding mismatches ✗; R6.4 `increment(2)` / `(0)`, no tick,
  tick id mismatch ✗; **R6.5 a hand-in requires a member doc with the SAME name**: no
  member doc, another name, a spelling difference, another nameKey, another class, a
  teacher ✗; R6.6 forged uid / ownerUid / createdAt / kind (`'pyth0n'`, also with a
  workspace), extra fields, the old title / note / taskId ✗; R6.7 bad id ✗; R6.8 sizes;
  R6.9 kind vs workspace (Code with a workspace, Blocks without one; plain and gzip); R6.10
  cooldown; R6.11 cap of 300; **R6.12 after a Change**: old name ✗, new name ✓, counter
  carries on; R6.13 rename + hand-in in one batch ✗; R6.14 stopped or deleting ✗; R6.15
  create member + tick + hand-in in one batch ✗; R6.16 a retry with the same id after
  success ✗, and the member doc shows the id; **R6.17 Python hand-ins** (docs/PYTHON.md
  §8.2): the program in `workspace`, plain and gzip, a 100,000-byte program (the rules'
  limit) ✓, and Code / Blocks hand-ins pass as before; **R6.18** a Python hand-in with an
  empty workspace (plain and gzip), a program over 100,000 bytes (plain, 2-byte
  characters, gzip), an empty sketch, mixed field types, a non-string workspace or an
  extra `python` field ✗ (then the same member hands in a valid one ✓).
- **R7 hand-ins, read / delete / prune.** R7.1 the student query by uid ✓; a query by
  nameKey, others' docs ✗; R7.2 nobody edits a hand-in (student or owner); R7.3 owner
  list / window / per nameKey / `count()` / get; R7.4 another teacher ✗; R7.5
  collection-group queries ✗; R7.7 double delete ✓; R7.8 prune query and batch.
- **R8.** R8.1 delete-class flow (61 deletes in one batch, no rule reads); R8.2 unknown
  collections ✗.

**Mutation check.** `tests-emulator/mutations.sh` re-runs the suite against each file in
`tests-emulator/mutations/` (the rules with one protection removed:
`delete-not-idempotent`, `enc-types-unchecked`, `handin-name-unchecked`,
`handin-owner-unchecked`, `handins-open-ignored`, `member-owner-unchecked`,
`name-pattern-unchecked`, `python-workspace-unchecked` (the §8.2 ternary of
docs/PYTHON.md reverted), `rename-any-field`, `student-reads-others`,
`tick-not-bound-to-new-handin`). Each mutation must make at least one test fail
(verified 2026-09-29: all 11 caught; `python-workspace-unchecked` by R6.17 and R6.18).
CI runs it in the `emulator-tests` job (§7.6).

**Mutation drift test.** Each mutation is a copy of `firestore.rules`, so a copy made from
an older version of the rules could be "caught" for the wrong reason. `tests/rules-mutations.test.ts`
(in `npm test`) checks that the set of files is the list above and that each one differs
from `firestore.rules` by 1-4 lines (removed + added, a line diff): when the rules change,
apply the change to every copy.

**Sync test.** `tests/classroom-model.test.ts` reads `firestore.rules` as text and
asserts that every limit in `LIMITS` that the rules use appears in it as the clause that
checks it (`textUpTo(d.name, 60)`, device 40, code 50000, workspace 100000, 300, keepWeeks
1-52, `{0,29}`, 61, 10 s), that every other key of `LIMITS` is listed as client-only
(`pythonMaxBytes` among them, and it is at most `workspaceMaxBytes`), `schema == 2`, the
exact Python clauses (`d.kind in ['code', 'blocks', 'python']` and the workspace ternary),
and that the code alphabet and the name regex appear in it.

### 7.2 Data layer (A)

**Unit** (node, the normal `npm test`):
- `tests/classroom-model.test.ts`: class codes (normalisation, `codeProblem`, format,
  link, uniform generation, rejection sampling), `newHandinId`, **student names**
  (`cleanName` NFC / spaces / cut, the `nameProblem` table, `nameKeyOf`, `fullName`,
  `listName`), `cleanLine`, `utf8Length`, the `deviceLabel` table, `draftProblem` (also
  a Python draft: no program, over 50,000 bytes), the document readers (the three kinds;
  `pyth0n`, a missing kind → Code), `contentOf`, the limits-in-rules sync test.
- `tests/classroom-codec.test.ts`: plain / gzip round trips, a Python program through
  the workspace field (plain and gzip), the decode caps.
- `tests/rules-mutations.test.ts`: the mutation drift test (§7.1).
- `tests/classroom-errors.test.ts`: unchanged (the code list has `bad_name`, no
  `class_closed` / `not_on_roster` / `bad_roster`).
- `tests/classroom-session-store.test.ts`: the v2 session round trip, a v1 entry is
  ignored, storages that throw, `currentStudentName`.
- `tests/classroom-student-unit.test.ts`, with a fake SDK (`setDoc`, `updateDoc` and
  the batch scriptable): `restore()` reads the class only and never loads Firebase
  without a session; `findClass` reports the existing name; **join**: cleaning, `bad_name`
  and `handins_closed` without a write, create, rename in place (no write for the same
  name), the create ↔ rename fallback on a denied write, both denied → diagnosis; the
  `diagnoseHandinRefusal` table; `handIn`: local checks, the batch with the
  denormalised name, timeout then `arrived`, the rename retry with the same id, the
  permission diagnosis, a Python hand-in (the same 10 keys, the program in `workspace`;
  no program / too large refused without a request); `forget` keeps the sign-in and the code.
- `tests/share-link.test.ts`: the share links (`#python=` too: Unicode, a 50,000-byte
  program, junk), `#class=`, the review payload (kind `python` with its program, older
  payloads without `python` → `''`, `'pyth0n'` refused, a large program through the
  `#rid=` handoff), `handinHash` (`#python=` for a Python hand-in).
- `tests/bundle-boundary.test.ts`: unchanged.

**Integration** (emulators, `npm run test:emulator`), in `tests-emulator/`:
- `student-api.test.ts`: findClass (bad, missing, stopped, open); join (member doc +
  session, `bad_name`, a class stopped meanwhile, **rename in place with the counter
  kept**, `forget` keeps the uid, a removed computer enters its name again); restore
  (same uid, `lost_identity`, stopped, deleted); handIn (plain and gzip with the name,
  cooldown, a name changed in another tab → retry with the same id, limit / stopped /
  deleting, the idempotent retry, **two computers under one name grouped by nameKey**,
  **Python hand-ins** plain and gzip read back by the teacher as kind `python`).
- `teacher-api.test.ts`: onUser; createClass (cleaned name, schema 2, exactly the §2.3
  keys, collision retry); watchClasses; watchClass (name, switch, clamped keepWeeks,
  deletion); watchMembers (names), removeDevice, removeUnusedDevices;
  watchTodayHandins with a real student hand-in; loadHandins / studentHandins by
  nameKey paging; countHandinsBefore, pruneHandins; deleteClass over 900 docs;
  deleteAllClasses, deleteAccount.
- `flow.test.ts`: teacher creates → student code + name + gzip hand-in → idempotent
  retry → live Today view (bomb refused by the cap) → **Change** name → hand in again
  → two students on the dashboard.

### 7.3 UI (happy-dom)

**B**:
- `tests/handin-dialog.test.ts`, with a fake `StudentApi` (in memory; each method a
  `vi.fn`): the Code view (prefill, inline code errors with the `codeProblem` detail,
  every `findClass` error text, `#class=` prefills the code without a restore and opens
  Ready for the remembered class); the Name view (class heading, work block, prefill
  from the member doc then the saved session, Hand in → `join` + `handIn` → Success,
  Enter, `bad_name` and the other join errors inline, the local checks and the
  untouched-example confirm before any request); the Ready view ("Hand in as … to class
  …", Last handed in, Change → `forget` + Code view, the local checks, one confirm for
  an untouched example, double click → one `handIn`, a new id after success, "Checking
  whether it arrived…", Try again with the same id, every error text, the
  `device_removed` / `class_deleted` / `handins_closed` buttons, a name changed elsewhere,
  a late answer ignored); the restore errors; the textContent matrix; **Python hand-ins**
  (docs/PYTHON.md §8.3, owner C): the draft with the program, the work line, the error
  count read from the placeholder (name view too), the untouched example / blank questions,
  an empty or too large program, the permission-denied text (Code and Blocks keep theirs).
- `tests/app-header.test.ts`: the button exists only when configured; the label "Hand
  in · Ali Khoury" from a saved session; `#class=` opens the dialog with the code.
- `tests/share-dialog.test.ts`, `tests/arduino-ide-dialog.test.ts`: download names from
  `currentStudentName()` (`zero1_Elise_M_…`).

**C**:
- `tests/teacher-dashboard.test.ts`, with `tests/fakes/fake-teacher-api.ts`: not
  configured; signed out (synchronous `signIn`, error texts); the class list (badges,
  **the last class is re-opened only when it is in the list**); create class (name only);
  the header (copy code / link, the overlay with the count and no members listener, the
  hand-ins switch); the Overview (one row per name "Last, First" grouped by nameKey,
  sort, New / Seen by nameKey, live inserts, periods, **one `#rid=` handoff per hand-in
  reused across renders**, `.ino` with no await, zips named after the students,
  keyboard); the detail (versions, older by nameKey, the blocks zip, Remove computer,
  Delete, decode problems, no Move to…); All hand-ins (names, filter); retention (**a
  complete paged download**, prune toast, once per tab); Settings (name, switch, weeks,
  **"Download everything first" pages through every hand-in**, delete with progress,
  Finish deleting); Delete my data; sign-out; the error banner; parked listeners; the
  textContent matrix over names, class name, code and device; **Python hand-ins**
  (docs/PYTHON.md §8.5): the "Python" label in the Overview, the detail and the feed, the
  program first and the sketch in a collapsed `<details>`, Download .py / .ino, Copy copies
  the program, the Open payload with `python`, "Handed in with N Python errors" with .ino
  disabled (detail and Overview), `.py` in the zips, the program rendered as text.
- `tests/review-page.test.ts` (the review banner shows "Ali Khoury's hand-in · 8B Robotics
  · …"; `task` and `title` are empty strings): for Python, "· Python", Download .py next to
  Download .ino, Copy copies the program, the errors note with .ino disabled, an older link
  without the program. `tests/zip.test.ts`: the writer, plus `zipEntries` (`.py` next to
  `.ino`, older versions, one unique stem per hand-in, undecoded records left out).

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
  - after `npm run test:emulator`, the mutation check (§7.1):
    `npx --yes firebase-tools@15.31.0 emulators:exec --only firestore --project demo-zero1 "sh tests-emulator/mutations.sh"`.
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
- `src/ui/arduino-ide-dialog.ts`: import `currentStudentName` instead of
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
    `currentStudentName()`.
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
  - class names;
  - the Firebase `ownerUid` (an opaque id), visible to code-holders (§3.5).
- **Students**: **no account data**. Anonymous Firebase users have only a uid and
  timestamps.
  - Students type their **first name and last name** themselves (2026-09-27). The names
    are visible to the teacher and to the device that typed them, never to other
    students (§3.5). A school that prefers pseudonyms tells its students what to type.
  - Hand-ins hold the code, blocks, time, the name at hand-in, the device uid, and a
    coarse device label ("Chrome · Windows"). No IP and no fingerprint are stored.
  - Google processes IP addresses for abuse protection: the per-IP sign-up limit, and
    reCAPTCHA when App Check is on. The app stores none.

**Minors.**
- No email, password, name or analytics is collected from students. There is no Google
  Analytics (step 1) and no tracking.
- reCAPTCHA (App Check) runs a Google risk check in the browser. When it is enabled,
  say so in the schools' notice.
- The teacher is the one who can see and delete the work.
- Schools using the deployment should mention it in their privacy notice. Firebase is a
  Google Cloud service under the Firebase / Google Cloud data processing terms; the
  maintainer is the project owner.

**Who can see what.**
- A teacher sees only their own classes.
- A student sees the class name of a class whose code they know, and nothing of other
  students.
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
| Q5 | Impersonation by typing a classmate's name | Accepted by the teacher (2026-09-27): the code is the only secret; device visibility, "2 computers within an hour", Delete, Remove computer. PIN in v1.1 only if schools ask (§3.7) |
| Q6 | Names in any alphabet | Accepted: `\p{L}` in both the client and the rules; file names are slugged (`zero1_Elise_M_…`) |
| Q7 | Transpiler escapes beyond X1's denylist | The sandbox is the real boundary. X1 is defence in depth; any new escape is a normal bug, not an account takeover |
| Q8 | SDK issue #10402 (a quota error at start-up clears the stored anonymous user) | Handled as `lost_identity`: the student types the code and their name again (a new member doc). Track the issue; bump `firebase` when it is fixed |
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

### Simplified by teacher decision (2026-09-27)

The teacher's decision, which overrides the flows above wherever they conflict: "let the
hand in be very simple: the teacher creates a class code and gives it to the students; a
student enters the class code, then inputs their name and surname, and the work is
handed in."

| what | resolution |
|---|---|
| Roster, usernames, "Shorten last names", near-duplicate warnings, Students tab, Rename / Remove / Let join again, "(removed) name" | **Removed.** The student types a first name and a last name (§2.4). `members/{uid}` stores `firstName`, `lastName`, `nameKey`; each hand-in carries a copy, checked by the rules against the member doc (§2.7-2.8, R6.5) |
| Joining controls (always open, 15-minute window, per-student rejoin), D14 | **Removed.** Only `handinsOpen` remains (§2.6) |
| Tasks, current task, title, note, task filters, Move to… (re-file), D15 | **Removed.** Hand-ins are immutable for everyone (§2.8, R7.2) |
| Pick / Already joined / Confirm / Switch / Joined views, the per-tab + 20-minute confirmation, My hand-ins, Sign out (new uid) | **Replaced** by one flow (code → name → Hand in) and the remembered "Hand in as … / Change" view, which is the shared-computer confirmation. "Change" keeps the anonymous uid and renames the member doc in place (D5, R4.8), so the 300 cap and the cooldown survive it |
| Untouched-example / blank second click | **Adapted** to a single confirm dialog |
| Teacher name on the class, `teacherName` | **Removed** (the Google profile is enough) |
| Schema | `schema: 2`; `firestore.indexes.json` indexes `nameKey + createdAt` instead of `studentId + createdAt`; the storage session is `v: 2` (a v1 entry is ignored) |
| Anyone with the code can hand in under any name | **Accepted** and documented (§3.5 item 1) |
| Rules cannot check the `nameKey` formula (`lower()` is ASCII-only) | **Accepted**: the key is a grouping aid with no security value; the rules check that it is short and lower-case-stable, and that a hand-in carries the member doc's key (§2.4, R4.3) |
| Reviewer findings folded in at the same time | one `#rid=` handoff per hand-in, memoised (T5, §4.13); "Download everything first" and "Download them" page through every hand-in with no cap (T9, §2.11); `z1.teacher.lastClass` is re-opened only when it is in the teacher's own list (T2) |

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

> Historical: the roster model. The 2026-09-27 mutation set is listed in §7.1.

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
