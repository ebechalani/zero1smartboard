/**
 * Application entry point: creates the real-time clock and the virtual ZERO1
 * board, then mounts the simulator UI into `<div id="app">`.
 */
import './ui/style.css';
import { RealClock } from './runtime/clock';
import { createZero1Board } from './zero1';
import { loadConfig } from './ui/settings';
import { mountApp } from './ui/app';

// The email relay (removed) remembered the teacher's address and the student's name; forget them once.
try {
  for (const key of ['teacherEmail', 'studentName']) localStorage.removeItem('z1.' + key);
} catch {
  // No storage (private mode, a sandboxed frame): nothing to forget.
}

const root = document.getElementById('app');
if (!root) {
  throw new Error('index.html must contain <div id="app"></div>');
}

const clock = new RealClock();
const board = createZero1Board(clock, loadConfig());
mountApp(root, board, clock);
