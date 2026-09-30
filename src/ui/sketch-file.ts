/**
 * The sketch as a file for the Arduino IDE: a sketch name the IDE accepts
 * and the download of `<name>.ino`. Used by the Share dialog and the
 * "Open in Arduino IDE" dialog; Python mode also downloads `<name>.py`.
 *
 * Names are unique per download on purpose. Opening a lone `name.ino`, the
 * Arduino IDE offers to create a `name/` folder next to it and move the file
 * in; a second download of the same name then either gets renamed by the
 * browser to `name (1).ino` (spaces and parentheses are refused by IDE 2) or
 * collides with the existing `name/` folder ("A folder named ... already
 * exists. Can't open sketch.").
 */

/** Sketch names accepted by the Arduino IDE 2 (arduino-ide sketches-service.ts). */
export const SKETCH_NAME_PATTERN = /^[0-9a-zA-Z_][0-9a-zA-Z_.-]{0,62}$/;

/** Arduino Cloud limits sketch names to 36 characters: stay within it so the file can be imported there too. */
export const MAX_SKETCH_NAME_LENGTH = 36;

const PREFIX = 'zero1';

/**
 * A fresh sketch name such as `zero1_Elise_0926_143205`: the student's name
 * (optional) reduced to letters, digits and `_`, then the month, day and time
 * of `date` in local time.
 */
export function sketchName(studentName: string, date: Date): string {
  const stamp = `${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const room = MAX_SKETCH_NAME_LENGTH - PREFIX.length - stamp.length - 2; // two '_' separators
  const slug = studentName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Élise → Elise
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, room)
    .replace(/_+$/, '');
  return slug ? `${PREFIX}_${slug}_${stamp}` : `${PREFIX}_${stamp}`;
}

/** `sketchName()` + `.ino`. */
export function sketchFileName(studentName: string, date: Date): string {
  return `${sketchName(studentName, date)}.ino`;
}

/**
 * Share ▾ → Download .py in Python mode (docs/PYTHON.md §7.11): the sketch name in lower case
 * (Python file names are), e.g. `zero1_ali_khoury_0928_143210.py`.
 */
export function pythonFileName(studentName: string, date: Date): string {
  return `${sketchName(studentName, date).toLowerCase()}.py`;
}

/**
 * Save `text` as a file through a temporary `<a download>`. Pass the open
 * modal dialog as `container`: a modal makes the rest of the page inert.
 */
export function downloadTextFile(fileName: string, text: string, container: HTMLElement = document.body): void {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.hidden = true;
  container.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
