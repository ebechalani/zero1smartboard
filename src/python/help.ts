/**
 * "What works in ZERO1 Python" (docs/PYTHON.md §2.15): the one-page student summary of §2–§3 that
 * the Python tab's note links to (§7.3). Owner A writes the content here; the dialog that shows
 * it is the app's (src/ui). Plain text only (no HTML): the dialog builds its own elements, so
 * the texts go in with textContent.
 */

/** One piece of a help section. */
export type HelpBlock =
  | { type: 'text'; text: string }
  /** Python code, shown as written (monospace, line breaks kept). */
  | { type: 'code'; code: string }
  | { type: 'list'; items: readonly string[] }
  | { type: 'table'; head: readonly string[]; rows: ReadonlyArray<readonly string[]> };

export interface HelpSection {
  heading: string;
  blocks: readonly HelpBlock[];
}

export interface HelpPage {
  title: string;
  sections: readonly HelpSection[];
}

/** The "What works" dialog's content. */
export const WHAT_WORKS: HelpPage = {
  title: 'What works in ZERO1 Python',
  sections: [
    {
      heading: 'The shape of a program',
      blocks: [
        { type: 'text', text: 'The lines before while True: run once, when the board starts. The lines inside while True: run again and again, forever.' },
        {
          type: 'code',
          code: [
            'from machine import Pin',
            'from zero1 import LED_RED',
            'import time',
            '',
            'led = Pin(LED_RED, Pin.OUT)   # runs once',
            '',
            'while True:                   # runs forever',
            '    led.on()',
            '    time.sleep(0.5)',
            '    led.off()',
            '    time.sleep(0.5)',
          ].join('\n'),
        },
        { type: 'text', text: 'A program without while True: runs once and then ends.' },
        {
          type: 'text',
          text: 'The Code tab shows the Arduino sketch made from your Python: it is what runs in the simulator and what goes to the board. The board itself cannot run Python.',
        },
      ],
    },
    {
      heading: 'The Python you can use',
      blocks: [
        {
          type: 'list',
          items: [
            'Whole numbers, decimal numbers, True / False, text ("…") and f-strings: f"T = {t:.1f}"',
            'if / elif / else, while, for i in range(…), for x in a_list, for ch in text, break, continue',
            'def with default values and keyword arguments, return, global',
            'Lists of one kind: [1, 2, 3], [0] * 10, append(), pop(), clear(), len(), in',
            'Colours as (r, g, b) for the RGB LED',
            'a, b = b, a and a = b = 0',
            'raise ValueError("…") and assert',
            'try / except around a sensor reading (except OSError:) or int() / float() of text (except ValueError:)',
            'Built-in functions: print, input, len, range, int, float, str, bool, abs, min, max, round, pow, chr, ord, sum',
            'Text methods: upper, lower, strip, startswith, endswith, find, replace, isdigit',
          ],
        },
      ],
    },
    {
      heading: 'Modules',
      blocks: [
        {
          type: 'table',
          head: ['Module', 'What it has'],
          rows: [
            ['machine', 'Pin, PWM, ADC, I2C, SoftI2C, time_pulse_us'],
            ['time (or utime)', 'sleep, sleep_ms, sleep_us, ticks_ms, ticks_us, ticks_diff, ticks_add, time'],
            ['neopixel', 'NeoPixel (the RGB LED)'],
            ['dht', 'DHT22, DHT11 (temperature and humidity)'],
            ['hcsr04', 'HCSR04 (the ultrasonic distance sensor)'],
            ['math', 'pi, e, sqrt, sin, cos, tan, asin, acos, atan, atan2, exp, log, log10, fabs, floor, ceil, trunc, pow, radians, degrees, isnan, isinf'],
            ['random', 'randint, randrange, random, uniform, choice, seed'],
            ['micropython', 'const'],
            [
              'zero1',
              'The pin names LED_RED, LED_GREEN, LED_BUILTIN, BUTTON_1, BUTTON_2, POT_LDR, MOTOR, SERVO_PIN, BUZZER, DHT_PIN, TRIG_PIN, ECHO_PIN, RGB_PIN, SEG_DATA, SEG_LATCH, SEG_CLOCK, A0-A5, LCD_ADDRESS; the parts Servo, LCD, Buzzer, SevenSegment, HCSR04; map_range, input_available',
            ],
          ],
        },
        {
          type: 'text',
          text: 'Standard parts take a pin: Pin(LED_RED, Pin.OUT), ADC(POT_LDR), NeoPixel(Pin(RGB_PIN), 1), dht.DHT22(Pin(DHT_PIN)). ZERO1 parts are already wired, so they take none: Servo(), LCD(), Buzzer(), SevenSegment(), HCSR04().',
        },
      ],
    },
    {
      heading: 'Not in ZERO1 Python yet',
      blocks: [
        {
          type: 'list',
          items: [
            'classes, dictionaries and sets, tuples (except colours)',
            'try / except except the two forms above, with, finally',
            'slices a[1:3], lambda, [x for x in …], generators (yield)',
            'None as a value, is / is not, * and ** arguments, def inside def',
            'list methods other than append, pop and clear; % and .format() (use f-strings)',
          ],
        },
        { type: 'text', text: 'When you use one of them, the console says so before the program runs, with a way to write it that works.' },
      ],
    },
    {
      heading: 'Numbers on the board',
      blocks: [
        { type: 'text', text: 'The board computes like a small computer, not like Python on a PC. The simulator does exactly what the board does.' },
        {
          type: 'table',
          head: ['You write', 'Python on a PC', 'ZERO1 board'],
          rows: [
            ['whole numbers', 'no limit', '-2147483648 … 2147483647, then they wrap around like an odometer'],
            ['a = 50000; print(a * a)', '2500000000', '-1794967296'],
            ['decimal numbers', 'about 16 digits', 'about 7 digits'],
            ['print(1 / 3)', '0.3333333333333333', '0.3333333'],
            ['print(0.1 + 0.2)', '0.30000000000000004', '0.3'],
            ['0.1 + 0.2 == 0.3', 'False', 'True'],
            ['f"{2.5:.0f}"', '2', '3'],
            ['round(2.675, 2)', '2.67', '2.68'],
            ['print(min(2, 2.5))', '2', '2.0'],
            ['//, %, round(), int()', 'floor, sign of the divisor, halves to even, cut toward 0', 'the same'],
            ['division by zero', 'ZeroDivisionError', 'the program stops with ZeroDivisionError on that line'],
            ['a list or text index out of range', 'IndexError', 'the program stops with IndexError on that line'],
            ['int("12abc")', 'ValueError', 'the program stops with the same ValueError'],
            ['2 ** n with a negative n', '0.5', 'the program stops: write 2.0 ** n'],
            ['time.sleep(-1)', 'ValueError', 'the program stops with the same ValueError'],
            ['time.sleep_ms(1.5)', 'TypeError (MicroPython)', 'refused before running: use a whole number'],
            ['growing a list', 'no limit', '20 extra items, then MemoryError'],
            ['len("été")', '3', '5 (accented letters take 2 bytes)'],
            ['time.ticks_ms()', 'wraps (MicroPython)', 'wraps after 24.8 days: use time.ticks_diff()'],
            ['a function that calls itself', 'stops at 1000 calls', 'the board crashes at about 50 calls'],
            ['input()', 'reads a line', 'the same, and shows the line; it waits until you send one'],
          ],
        },
      ],
    },
  ],
};
