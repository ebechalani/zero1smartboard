/**
 * ZERO1 Smart Board simulator: email relay (Google Apps Script).
 *
 * The simulator is a static web page, so it cannot send email by itself.
 * When a student presses "Send to teacher", the page sends their work to this
 * script, which checks it and emails it to the teacher from YOUR Google
 * account (MailApp). Nothing else opens on the student's computer.
 *
 * Set-up, once (about 10 minutes): follow docs/EMAIL.md in the simulator's
 * repository. In short: paste this file into a new project on
 * script.google.com, edit the SETTINGS below, run sendTestEmail once, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone)
 * and put the web app URL (ending in /exec) in the simulator's src/config.ts.
 *
 * Safety: the web app URL is public (it is written in the simulator's page),
 * so anyone who has it can send a short email (a name, a message of up to 500
 * characters and some code, which may contain web addresses) from your
 * account. That is why this script only emails the addresses allowed below
 * and sends at most MAX_EMAILS_PER_HOUR emails an hour. Only the "Open it in
 * the simulator" button is checked to lead to SIMULATOR_URL.
 */

// ============================================================================
// SETTINGS: edit these values. After a change, deploy a new version
// (Deploy > Manage deployments > Edit > Version: New version > Deploy).
// ============================================================================

/**
 * Email domains that may receive work: the part after the "@", for example
 * ['myschool.edu']. The match is exact, so 'myschool.edu' allows
 * teacher@myschool.edu but NOT teacher@staff.myschool.edu (add
 * 'staff.myschool.edu' to the list for that). If students also have
 * addresses at this domain, list the teachers in ALLOWED_ADDRESSES instead.
 */
const ALLOWED_DOMAINS = [];

/**
 * Single addresses that may receive work, for example a teacher with an
 * address outside the school domain: ['j.smith@gmail.com'].
 */
const ALLOWED_ADDRESSES = [];

// With both lists empty, work can only be emailed to you, the owner of this
// script. You are always allowed.

/** The simulator. The "Open it in the simulator" link in an email must start with this address. */
const SIMULATOR_URL = 'https://ebechalani.github.io/zero1smartboard/';

/** Developers only: also accept links to a copy of the simulator on http://localhost. */
const DEV = false;

/** Most emails sent in one hour, all students together (protects your daily email quota). */
const MAX_EMAILS_PER_HOUR = 60;

/** The sender name shown in the teacher's inbox. */
const SENDER_NAME = 'ZERO1 Simulator';

// ============================================================================
// Nothing to edit below this line. Functions whose name ends with "_" are
// helpers: Apps Script hides them from the Run menu.
// ============================================================================

/** Longest accepted request body, in characters (checked before parsing it). */
const MAX_REQUEST_LENGTH_ = 400000;
/** Field limits. The simulator (src/ui/share-dialog.ts) uses the same numbers. */
const MAX_NAME_LENGTH_ = 60;
const MAX_MESSAGE_LENGTH_ = 500;
const MAX_LINK_LENGTH_ = 60000;
const MAX_CODE_LENGTH_ = 100000;
/** Longest email address allowed by the mail standards, and its part before the "@". */
const MAX_ADDRESS_LENGTH_ = 254;
const MAX_LOCAL_PART_LENGTH_ = 64;
/**
 * Largest plain + HTML email text, in UTF-8 bytes. Apps Script refuses email
 * bodies over 200 KB (consumer accounts); longer code is left out of the text
 * and only attached.
 */
const MAX_BODY_BYTES_ = 150000;

/**
 * A plain email address, ASCII only: letters, digits and . _ + - ' before the
 * "@" (no quotes, spaces, commas, angle brackets, "%" or "!", so one value
 * can never add a second recipient or route the email elsewhere), then a
 * domain name of at least two labels.
 */
const ADDRESS_PATTERN_ =
  /^[A-Za-z0-9_+'-]+(?:\.[A-Za-z0-9_+'-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Characters a link may contain (RFC 3986, without quotes, spaces, "<", ">" or "\"). */
const LINK_CHARACTERS_ = /^[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+$/;
/** Links to a local copy of the simulator, accepted only when DEV is true. */
const LOCALHOST_LINK_ = /^http:\/\/localhost(?::\d{1,5})?\//;

/** Attachment names the simulator produces (src/ui/sketch-file.ts); anything else is replaced. */
const FILE_NAME_PATTERN_ = /^zero1[A-Za-z0-9_]{0,40}\.ino$/;
const DEFAULT_FILE_NAME_ = 'zero1_sketch.ino';

/** Invisible characters removed from the name and the message: controls, format (bidi, zero-width) and lone surrogates. */
const INVISIBLE_ = /[\p{Cc}\p{Cf}\p{Cs}]/gu;
const INVISIBLE_EXCEPT_NEWLINE_ = /(?!\n)[\p{Cc}\p{Cf}\p{Cs}]/gu;

const SEPARATOR_ = '----------------------------------------';

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

/**
 * Receive a student's work from the simulator and email it to the teacher.
 * The body is JSON sent as text/plain (so the browser sends no CORS
 * preflight): { to, studentName, message, kind, link, code, fileName }.
 * Answers { ok: true } or { ok: false, error, message }; never throws.
 */
function doPost(e) {
  let result;
  try {
    result = handleRequest_(e);
  } catch (err) {
    result = failure_('send_failed', 'Unexpected error: ' + errorText_(err));
  }
  if (!result.ok) console.warn('ZERO1 relay refused a request: ' + result.error + ' (' + result.message + ')');
  return jsonResponse_(result);
}

/** Open the web app URL in a browser to check that it works. */
function doGet() {
  return jsonResponse_({ ok: true, service: 'zero1-email-relay' });
}

/**
 * Run this once from the editor (choose sendTestEmail next to the Run button,
 * then press Run): Google asks you to allow the script to send email, then it
 * emails an example sketch to you. The result is shown in the Execution log.
 */
function sendTestEmail() {
  const code =
    'void setup() {\n  pinMode(A1, OUTPUT); // red LED\n}\n\nvoid loop() {\n  digitalWrite(A1, HIGH);\n  delay(500);\n  digitalWrite(A1, LOW);\n  delay(500);\n}\n';
  const request = {
    to: ownerEmail_(),
    studentName: 'Test Student',
    message: 'This is a test email from the ZERO1 email relay.',
    kind: 'code',
    // The simulator's own #code= link for the sketch above (base64url, UTF-8, no padding).
    link:
      simulatorPrefix_(SIMULATOR_URL) +
      '#code=dm9pZCBzZXR1cCgpIHsKICBwaW5Nb2RlKEExLCBPVVRQVVQpOyAvLyByZWQgTEVECn0KCnZvaWQgbG9vcCgpIHsKICBkaWdpdGFsV3JpdGUoQTEsIEhJR0gpOwogIGRlbGF5KDUwMCk7CiAgZGlnaXRhbFdyaXRlKEExLCBMT1cpOwogIGRlbGF5KDUwMCk7Cn0K',
    code: code,
    fileName: 'zero1_test.ino',
  };
  const result = handleRequest_({ postData: { contents: JSON.stringify(request) } });
  console.log(result.ok ? 'Test email sent to ' + request.to : 'Not sent: ' + result.error + ' (' + result.message + ')');
  return result;
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

/** Parse, check, rate-limit and send. Returns the answer for the simulator. */
function handleRequest_(e) {
  const contents = e && e.postData ? e.postData.contents : undefined;
  if (typeof contents !== 'string' || contents === '') return failure_('bad_request', 'The request has no body.');
  if (contents.length > MAX_REQUEST_LENGTH_) return failure_('bad_request', 'The request is too long.');
  let data;
  try {
    data = JSON.parse(contents);
  } catch (err) {
    return failure_('bad_request', 'The request is not valid JSON.');
  }

  const checked = validateRequest_(data, SIMULATOR_URL, DEV);
  if (!checked.ok) return checked;
  const request = checked.request;

  if (!isRecipientAllowed_(request.to, ALLOWED_DOMAINS, ALLOWED_ADDRESSES, ownerEmail_())) {
    return failure_('recipient_not_allowed', request.to + ' is not in ALLOWED_DOMAINS or ALLOWED_ADDRESSES.');
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    return failure_('quota_exceeded', 'The daily email quota of this Google account is used up.');
  }
  if (!reserveHourlySlot_()) {
    return failure_('rate_limited', 'More than ' + MAX_EMAILS_PER_HOUR + ' emails this hour, or the relay is busy.');
  }

  const email = composeEmail_(request);
  try {
    MailApp.sendEmail({
      to: request.to,
      subject: email.subject,
      body: email.body,
      htmlBody: email.htmlBody,
      name: SENDER_NAME,
      attachments: [Utilities.newBlob(request.code, 'text/plain', request.fileName)],
    });
  } catch (err) {
    return failure_('send_failed', 'MailApp could not send the email: ' + errorText_(err));
  }
  return { ok: true };
}

/**
 * Check every field of a parsed request, with explicit limits. Returns
 * { ok: true, request } with cleaned values, or a 'bad_request' failure.
 */
function validateRequest_(data, simulatorUrl, allowLocalhost) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return failure_('bad_request', 'The request must be a JSON object.');
  }
  if (!isValidAddress_(data.to)) return failure_('bad_request', '"to" is not a valid email address.');

  // A name or message far over its limit is refused before it is cleaned (the
  // simulator sends them already cut), so that no request keeps the relay busy.
  if (typeof data.studentName === 'string' && data.studentName.length > MAX_NAME_LENGTH_ * 2) {
    return failure_('bad_request', '"studentName" is longer than ' + MAX_NAME_LENGTH_ + ' characters.');
  }
  const studentName = cleanName_(data.studentName);
  if (studentName === '') return failure_('bad_request', '"studentName" is missing.');
  if (studentName.length > MAX_NAME_LENGTH_) {
    return failure_('bad_request', '"studentName" is longer than ' + MAX_NAME_LENGTH_ + ' characters.');
  }

  if (data.message !== undefined && data.message !== null && typeof data.message !== 'string') {
    return failure_('bad_request', '"message" must be text.');
  }
  if (typeof data.message === 'string' && data.message.length > MAX_MESSAGE_LENGTH_ * 2) {
    return failure_('bad_request', '"message" is longer than ' + MAX_MESSAGE_LENGTH_ + ' characters.');
  }
  const message = cleanMessage_(data.message);
  if (message.length > MAX_MESSAGE_LENGTH_) {
    return failure_('bad_request', '"message" is longer than ' + MAX_MESSAGE_LENGTH_ + ' characters.');
  }

  if (data.kind !== 'code' && data.kind !== 'blocks') return failure_('bad_request', '"kind" must be "code" or "blocks".');

  // The link may be left out (the simulator does so when it is too long); a link that is sent must lead to the simulator.
  const link = data.link === undefined || data.link === null || data.link === '' ? '' : data.link;
  if (link !== '' && !isSimulatorLink_(link, simulatorUrl, allowLocalhost)) {
    return failure_('bad_request', '"link" must start with ' + simulatorPrefix_(simulatorUrl) + ' and be at most ' + MAX_LINK_LENGTH_ + ' characters.');
  }

  if (typeof data.code !== 'string' || data.code.trim() === '') return failure_('bad_request', '"code" is missing.');
  if (data.code.length > MAX_CODE_LENGTH_) {
    return failure_('bad_request', '"code" is longer than ' + MAX_CODE_LENGTH_ + ' characters.');
  }

  const fileName = typeof data.fileName === 'string' && FILE_NAME_PATTERN_.test(data.fileName) ? data.fileName : DEFAULT_FILE_NAME_;

  return {
    ok: true,
    request: { to: data.to, studentName: studentName, message: message, kind: data.kind, link: link, code: data.code, fileName: fileName },
  };
}

// ---------------------------------------------------------------------------
// Checks (pure)
// ---------------------------------------------------------------------------

/** Whether `value` is one plain email address (see ADDRESS_PATTERN_). */
function isValidAddress_(value) {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH_) return false;
  if (!ADDRESS_PATTERN_.test(value)) return false;
  return value.lastIndexOf('@') <= MAX_LOCAL_PART_LENGTH_;
}

/**
 * Whether the relay may email `address` (already checked by isValidAddress_):
 * the script owner, an address of `allowedAddresses`, or an address whose
 * domain (after the last "@") is exactly one of `allowedDomains`. Case does
 * not matter.
 */
function isRecipientAllowed_(address, allowedDomains, allowedAddresses, ownerEmail) {
  const wanted = String(address).toLowerCase();
  if (ownerEmail && wanted === String(ownerEmail).trim().toLowerCase()) return true;
  for (let i = 0; i < allowedAddresses.length; i++) {
    if (wanted === String(allowedAddresses[i]).trim().toLowerCase()) return true;
  }
  const domain = wanted.slice(wanted.lastIndexOf('@') + 1);
  for (let i = 0; i < allowedDomains.length; i++) {
    if (domain === String(allowedDomains[i]).trim().toLowerCase().replace(/^@/, '')) return true;
  }
  return false;
}

/**
 * Whether `link` leads to the simulator: it starts with
 * simulatorPrefix_(simulatorUrl) or, when `allowLocalhost` is true, with
 * http://localhost/ or http://localhost:<port>/.
 */
function isSimulatorLink_(link, simulatorUrl, allowLocalhost) {
  if (typeof link !== 'string' || link.length > MAX_LINK_LENGTH_ || !LINK_CHARACTERS_.test(link)) return false;
  if (link.indexOf(simulatorPrefix_(simulatorUrl)) === 0) return true;
  return allowLocalhost === true && LOCALHOST_LINK_.test(link);
}

/** The simulator's address ending with "/", so that a link cannot extend its host name. */
function simulatorPrefix_(url) {
  return /\/$/.test(url) ? url : url + '/';
}

/** The student's name on one line: invisible characters removed, spaces collapsed. */
function cleanName_(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s/g, ' ').replace(INVISIBLE_, '').replace(/ {2,}/g, ' ').trim();
}

/** The student's message: line breaks kept (at most one empty line in a row), other invisible characters removed. */
function cleanMessage_(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]/g, ' ')
    .replace(INVISIBLE_EXCEPT_NEWLINE_, '')
    .split('\n')
    .map((line) => line.trimEnd()) // not / +\n/: that regex takes quadratic time on a long run of spaces
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Email (pure)
// ---------------------------------------------------------------------------

/**
 * Subject, plain text and HTML of the email for a validated request. The code
 * is shown in the email unless the text would get too long for Apps Script;
 * it is always attached as `fileName` too.
 */
function composeEmail_(request) {
  const full = composeEmailParts_(request, true);
  if (utf8Length_(full.body) + utf8Length_(full.htmlBody) <= MAX_BODY_BYTES_) return full;
  return composeEmailParts_(request, false);
}

function composeEmailParts_(request, showCode) {
  const blocks = request.kind === 'blocks';
  const name = request.studentName;
  const what = blocks ? 'a blocks program' : 'a sketch';
  const codeTitle = blocks ? 'Arduino code generated from their blocks:' : 'Arduino code:';
  const attached = blocks ? 'The generated code is also attached as ' : 'The code is also attached as ';
  const footer = 'Sent by the ZERO1 Smart Board simulator. The name and the message were typed by the student.';

  const text = ['Hello,', '', name + ' sent you ' + what + ' from the ZERO1 Smart Board simulator.', ''];
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1e1633">',
    '<p><strong>' + escapeHtml_(name) + '</strong> sent you ' + what + ' from the ZERO1 Smart Board simulator.</p>',
  ];

  if (request.message) {
    text.push('Message from ' + name + ':', request.message, '');
    html.push(
      '<p style="margin:0">Message from ' + escapeHtml_(name) + ':</p>',
      '<p style="margin:4px 0 16px;padding:8px 12px;border-left:3px solid #7c3aed;background:#f5f3fa">' +
        escapeHtml_(request.message).replace(/\n/g, '<br>') +
        '</p>',
    );
  }

  if (request.link) {
    text.push(blocks ? 'Open it in the simulator to see the blocks:' : 'Open it in the simulator:', request.link, '');
    html.push(
      '<p><a href="' +
        escapeHtml_(request.link) +
        '" style="display:inline-block;padding:8px 14px;border-radius:6px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:bold">Open it in the simulator</a></p>',
    );
  } else {
    const noLink = 'The simulator link was too long to send, so this email has the code only.';
    text.push(noLink, '');
    html.push('<p>' + noLink + '</p>');
  }

  const fileName = request.fileName;
  if (showCode) {
    text.push(codeTitle, SEPARATOR_, request.code.replace(/\s+$/, ''), SEPARATOR_, '');
    text.push(attached + fileName + ': it opens in the Arduino IDE.');
    html.push(
      '<p style="margin:16px 0 4px">' + codeTitle + '</p>',
      '<pre style="margin:0;padding:12px;border:1px solid #e2dcee;border-radius:6px;background:#f5f3fa;font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap">' +
        escapeHtml_(request.code.replace(/\s+$/, '')) +
        '</pre>',
      '<p>' + attached + '<strong>' + escapeHtml_(fileName) + '</strong>: it opens in the Arduino IDE.</p>',
    );
  } else {
    const tooLong = 'The code is too long to show here: it is in the attached file ';
    text.push(tooLong + fileName + ', which opens in the Arduino IDE.');
    html.push('<p>' + tooLong + '<strong>' + escapeHtml_(fileName) + '</strong>, which opens in the Arduino IDE.</p>');
  }

  text.push('', '--', footer);
  html.push('<p style="margin-top:24px;color:#5f5878;font-size:12px">' + footer + '</p>', '</div>');

  return {
    subject: (blocks ? 'ZERO1 blocks program from ' : 'ZERO1 sketch from ') + name,
    body: text.join('\n'),
    htmlBody: html.join('\n'),
  };
}

/** Text made safe to put inside HTML, including attribute values. */
function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Size of `text` in UTF-8 bytes (a lone surrogate counts as the 3-byte replacement character). */
function utf8Length_(text) {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Google services
// ---------------------------------------------------------------------------

/** The address of the account the web app runs as (the teacher who deployed it), or ''. */
function ownerEmail_() {
  try {
    return Session.getEffectiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}

/**
 * Count one more email in this clock hour; false when the hour's
 * MAX_EMAILS_PER_HOUR are used up or the lock cannot be taken (too many
 * requests at once). Best effort: if the cache fails, the email is allowed
 * (the daily quota still applies).
 */
function reserveHourlySlot_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    const cache = CacheService.getScriptCache();
    const key = 'zero1-sent-' + Math.floor(Date.now() / 3600000);
    const sent = Number(cache.get(key)) || 0;
    if (sent >= MAX_EMAILS_PER_HOUR) return false;
    cache.put(key, String(sent + 1), 3900); // seconds: the rest of the hour and a margin
    return true;
  } catch (err) {
    return true;
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function failure_(error, message) {
  return { ok: false, error: error, message: message };
}

function errorText_(err) {
  return err && err.message ? String(err.message) : String(err);
}
