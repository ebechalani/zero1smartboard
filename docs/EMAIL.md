# Sending work to the teacher by email

In the simulator, **Share → Send to teacher** emails a student's work
straight to the teacher: the student types the teacher's address, their name
and an optional message, presses **Send to teacher**, and a minute later the
teacher gets an email with:

- the student's name and message,
- a link that opens the work in the simulator (the sketch, or the blocks),
- the Arduino code, and
- the code as an `.ino` file attachment that opens in the Arduino IDE.

Nothing else opens on the student's computer: no Gmail, no Outlook, no email
app.

## Why a set-up is needed

The simulator is a static web page (GitHub Pages). A web page cannot send an
email by itself. So the page hands the work to a very small program that
**you**, the teacher, run in your own Google account: a *Google Apps Script
web app*. That script checks the work and sends the email with your account.

```
student's browser ──(the work)──▶ your Apps Script web app ──(email)──▶ teacher's inbox
```

You set it up **once** (about 10 minutes). It is free. The script is the file
[`tools/email-relay/Code.gs`](../tools/email-relay/Code.gs) in this repository.

Until it is set up, the Share dialog shows *"Sending to your teacher is not
set up on this simulator yet — use Copy link or Download .ino."* and students
hand in their work with those two buttons.

## What you need

- A Google account: your school Google Workspace account or a personal Gmail
  account. **The emails are sent from this account.**
- About 10 minutes, on a computer.

## Step 1 — Create the script

1. Go to [script.google.com](https://script.google.com) and sign in with the
   Google account that will send the emails.
2. Click **New project**.
3. Click **Untitled project** at the top and rename it, for example
   `ZERO1 email relay`.
4. Open [`tools/email-relay/Code.gs`](../tools/email-relay/Code.gs) on GitHub
   and copy all of it (the **Copy raw file** button at the top right of the
   file copies everything).
5. Back in the Apps Script editor, delete everything in `Code.gs` and paste.
6. Edit the **SETTINGS** block at the top of the script:
   - `ALLOWED_DOMAINS` — your school's email domain, the part after the `@`
     in the teachers' addresses. For `j.smith@myschool.edu`:

     ```js
     const ALLOWED_DOMAINS = ['myschool.edu'];
     ```

     The match is exact: `myschool.edu` does **not** allow
     `j.smith@staff.myschool.edu`. Add `'staff.myschool.edu'` to the list if
     teachers use such addresses.
   - `ALLOWED_ADDRESSES` — single addresses outside those domains, if any,
     for example `['j.smith@gmail.com']`.
   - If you leave **both lists empty**, the script only sends to **you** (the
     owner of the script). That is the simplest choice when you are the only
     teacher using it. You are always allowed, whatever the lists say.
   - Keep `SIMULATOR_URL` as it is (change it only if you host your own copy
     of the simulator at another address). Every link in an email must start
     with it.
   - `MAX_EMAILS_PER_HOUR` (60) is enough for a class; `DEV` stays `false`.
7. Click the **Save** icon (or press Ctrl+S).

## Step 2 — Give the script permission to send email, and test it

1. In the toolbar above the code, choose **sendTestEmail** in the list of
   functions (next to **Run** and **Debug**), then click **Run**.
2. Google asks for permission: click **Review permissions** and choose your
   account.
3. You may see **"Google hasn't verified this app"**. That is expected: it is
   your own script, not an app from a company. Click **Advanced**, then
   **Go to ZERO1 email relay (unsafe)**.
4. Google lists what the script needs: to send email as you, and to see your
   email address (to know who owns the script). If there are check boxes,
   tick them all. Click **Allow** (or **Continue**).
5. The **Execution log** at the bottom shows `Test email sent to …` and the
   test email arrives in your inbox, with `zero1_test.ino` attached. Click
   **Open it in the simulator** in that email: the simulator opens with the
   test sketch.

## Step 3 — Deploy the script as a web app

1. Click **Deploy** (top right) → **New deployment**.
2. Next to **Select type**, click the gear icon ⚙ → **Web app**.
3. Fill in:
   - **Description**: `ZERO1 email relay`
   - **Execute as**: **Me** (your address)
   - **Who has access**: **Anyone**
4. Click **Deploy**. If Google asks for permission again, do as in Step 2.
5. Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfycb…/exec` — it must end in
   **`/exec`**.
6. Click **Done**.

Why **Anyone**? Students use the simulator without signing in to Google, so
the page must be able to reach the script without an account. This does not
give anyone access to your Google account, your email or your files: the
only thing the URL can do is run the script above, which only sends the
emails described here (see [Privacy and safety](#privacy-and-safety)).

## Step 4 — Check the URL

Open the web app URL in a new browser tab. You should see:

```
{"ok":true,"service":"zero1-email-relay"}
```

If Google shows an error page instead ("Sorry, unable to open the file at
this time"), you are probably signed in to several Google accounts at once:
try again in a private (incognito) window.

## Step 5 — Put the URL in the simulator

**Either** edit the simulator on GitHub (if you manage the repository):

1. On GitHub, open `src/config.ts` and click the pencil icon (**Edit this
   file**).
2. Put your URL between the quotes:

   ```ts
   export const EMAIL_RELAY_URL = 'https://script.google.com/macros/s/AKfycb…/exec';
   ```

3. Click **Commit changes…** and commit to the `main` branch. GitHub Pages
   rebuilds the simulator in a few minutes (see the **Actions** tab).
4. Reload the simulator and press **Share**: the **Send to your teacher**
   section is there. Send a test to yourself.

**Or** send the URL to the person who maintains the simulator.

## Updating the script later

To change a setting (for example to add a domain) or to install a newer
`Code.gs`:

1. Edit the script and **Save**.
2. Click **Deploy** → **Manage deployments**, select the active deployment,
   click the pencil icon (**Edit**), set **Version** to **New version**, then
   **Deploy**.

The web app URL stays the same, so nothing changes in the simulator. Do
**not** use **New deployment** for this: it creates a new URL.

To switch the relay off: **Deploy** → **Manage deployments** → **Archive**
(students then see "Could not reach the email service" or "unexpected
answer"), and empty `EMAIL_RELAY_URL` again to hide the section.

## Quotas and limits

- **Google's daily limit.** Apps Script can email about **100 recipients a
  day from a personal Gmail account** and **1,500 a day from a Google
  Workspace account**. Each student email counts as one. Check the current
  numbers on Google's
  [Quotas for Google Services](https://developers.google.com/apps-script/guides/services/quotas)
  page ("Email recipients per day"). When the limit is reached, students see
  *"The email service cannot send any more emails today…"* until Google
  resets it.
- **The relay's own limit.** At most `MAX_EMAILS_PER_HOUR` emails an hour
  (60), all students together, so nobody can use up your daily limit in a
  few minutes.
- **Size.** Names up to 60 characters, messages up to 500, code up to
  100,000 characters. A very long code is attached but not shown in the
  email text (Google refuses email texts over 200 KB). A share link longer
  than 60,000 characters (a very large blocks program) is left out; the email
  then has the code only and the student is told so.

## Google Workspace (school) accounts

Your school's administrator decides what Apps Script may do. You may find
that:

- **Who has access** offers only *Anyone within <your school>*, not
  **Anyone**. The relay does not work with that setting (students are not
  signed in). Ask your IT team to allow web apps that anyone can use, or
  deploy the script from another Google account (for example a Gmail
  account made for the class) — with `ALLOWED_DOMAINS` set to your school
  domain, the emails still go to school addresses.
- Apps Script is switched off, or scripts that are not verified by Google
  are blocked. Ask your IT team, or use another Google account as above.

## Privacy and safety

- **What is sent**: the address the student typed, the student's name, their
  message, the share link and the code. The email is sent from the Google
  account that deployed the script, with the sender name *ZERO1 Simulator*
  and the subject *ZERO1 sketch from <name>* (or *ZERO1 blocks program from
  <name>*). Replies go to that account, not to the student.
- **Nothing is stored** by the script, except a count of the emails sent in
  the current hour. The **Executions** page of the Apps Script project lists
  every request; refused ones are logged with the reason.
- **The URL is public** (it is written in the simulator's page), so anyone
  could call it. That is why the script only emails the addresses you
  allowed, only puts links to the simulator (`SIMULATOR_URL`) in its emails,
  escapes everything the student typed, and stops after `MAX_EMAILS_PER_HOUR`
  emails an hour. It cannot read your email, your files or anything else in
  your account.
- **Names are typed by the students**: the name in an email is what the
  student typed, like a name written on a sheet of paper.

## Troubleshooting

What the student sees in the Share dialog, and what to do:

| Message | Likely cause | What to do |
|---------|--------------|------------|
| Sending to your teacher is not set up on this simulator yet | `EMAIL_RELAY_URL` in `src/config.ts` is empty. | Step 5. |
| Could not reach the email service. Check your internet connection and try again. | The student is offline; the school network blocks `script.google.com`; **Who has access** is not **Anyone** (Google answers with a sign-in page the browser does not pass on); the URL is wrong; the deployment was archived. | Open the URL yourself (Step 4). Redeploy with **Who has access: Anyone** (Step 3). Ask IT to allow `script.google.com` and `script.googleusercontent.com`. |
| This simulator can only send to school teachers' addresses. Check the email address. | The address is not in `ALLOWED_DOMAINS` / `ALLOWED_ADDRESSES` (with both lists empty: it is not the script owner's address), or it has a typo. | Check the address. Add the domain or the address, then deploy a new version (see *Updating the script later*). |
| Too many emails were sent from this simulator in the last hour. Try again later. | `MAX_EMAILS_PER_HOUR` was reached, or very many students pressed Send at the same moment. | Wait a few minutes, or raise `MAX_EMAILS_PER_HOUR` and deploy a new version. |
| The email service cannot send any more emails today… | Google's daily email limit for your account is used up. | Wait until tomorrow. A Google Workspace account has a higher limit. |
| The email service did not accept your work. Check the email address and your name, then try again. | A field was refused: an address with unusual characters (only letters, digits and `. _ + - '` are accepted before the `@`), or a link that does not start with `SIMULATOR_URL` (for example a copy of the simulator hosted elsewhere). | Check the address. If you host your own copy of the simulator, set `SIMULATOR_URL` to its address and deploy a new version. |
| The email could not be sent. Try again in a minute. | Google refused to send (for example the permission to send email was removed, or a temporary problem). The reason is on the **Executions** page. | Run **sendTestEmail** again (Step 2) to renew the permission, then try again. |
| The email service gave an unexpected answer… | The URL is not the relay: a `/dev` URL (it only works for you), another script, or an old deployment. | Use the `/exec` URL that shows `{"ok":true,"service":"zero1-email-relay"}` (Step 4). |
| Your code is too long to send by email. Use Download .ino instead. | The sketch is longer than 100,000 characters. | Download the `.ino` file. |

## For developers

- Request: `POST <EMAIL_RELAY_URL>` with a JSON body sent as `text/plain`
  (a "simple" request: no CORS preflight, which Apps Script cannot answer):
  `{ to, studentName, message, kind: 'code' | 'blocks', link, code, fileName }`.
  Apps Script answers through a redirect to `script.googleusercontent.com`,
  which `fetch` follows and which allows any origin.
- Answer: `{ ok: true }` or `{ ok: false, error, message }` with `error` one
  of `bad_request`, `recipient_not_allowed`, `rate_limited`,
  `quota_exceeded`, `send_failed`. `GET` answers
  `{ ok: true, service: 'zero1-email-relay' }`.
- The client is `sendWorkToTeacher()` in `src/ui/share-dialog.ts`; the field
  limits there and in `Code.gs` must stay equal (a test checks it).
- `tests/email-relay.test.ts` runs `Code.gs` in Node with fakes for
  `MailApp`, `Session`, `LockService`, `CacheService`, `ContentService` and
  `Utilities`.
- To try the relay with `npm run dev`, deploy a separate copy with
  `DEV = true` (it then also accepts `http://localhost` links) and put its
  URL in your local `src/config.ts` — do not commit it.

Google's documentation: [Web Apps](https://developers.google.com/apps-script/guides/web),
[Create and manage deployments](https://developers.google.com/apps-script/concepts/deployments),
[Quotas for Google Services](https://developers.google.com/apps-script/guides/services/quotas),
[MailApp](https://developers.google.com/apps-script/reference/mail/mail-app),
[Content Service](https://developers.google.com/apps-script/guides/content).
The Apps Script editor changes from time to time: if a button has a slightly
different name, look for the closest match.
