/**
 * Programs whose sketches once made avr-g++ warn at -Wall -Wextra or refuse them (docs/PYTHON.md
 * §4.7 E3, §2.9, §3.8): every one must translate, transpile and compile without a warning
 * (tests/python-emit.test.ts, tests-hardware-sim/python-board.test.ts).
 */
export const COMPILE_CASES: ReadonlyArray<{ name: string; source: string }> = [
  { name: 'a variable never read', source: 'x = 5\n' },
  { name: 'a loop variable never used', source: 'for v in [1, 2]:\n    print("y")\n' },
  { name: 'a parameter never used', source: 'def f(a, b):\n    return a\n\nprint(f(1, 2))\n' },
  { name: 'the number of form V never used', source: 's = "12"\ntry:\n    n = int(s)\nexcept ValueError:\n    print("bad")\n' },
  {
    name: 'a sensor reading never used',
    source: 'import dht\nfrom machine import Pin\nfrom zero1 import DHT_PIN\n\nsensor = dht.DHT22(Pin(DHT_PIN))\nsensor.measure()\nt = sensor.temperature()\n',
  },
  { name: 'a list whose only use is len()', source: 'lst = [1, 2]\nprint(len(lst))\n' },
  { name: 'a list only written', source: 'items = [1, 2]\nk = 1\nitems[k] = 0\n' },
  { name: 'a list parameter never used, and its length', source: 'def g(lst):\n    print("g")\n\nitems = [1, 2]\ng(items)\n' },
  { name: 'arithmetic of literals that leaves 32 bits', source: 'print(50000 * 50000)\nprint(2147483647 + 1)\nz = -2147483647 - 1 - 1\nprint(z)\n' },
  {
    name: 'n08: an LCD bitmap also given to a function',
    source:
      'from zero1 import LCD\n\nlcd = LCD()\nheart = [0, 10, 31, 31, 14, 4, 0, 0]\nlcd.custom_char(0, heart)\n\n\ndef count_on(bits):\n    n = 0\n    for b in bits:\n        if b > 0:\n            n += 1\n    return n\n\n\nprint(count_on(heart))\n',
  },
  {
    name: 'an LCD bitmap parameter',
    source:
      'from zero1 import LCD\n\nlcd = LCD()\n\n\ndef show(slot, bits):\n    lcd.custom_char(slot, bits)\n    lcd.putchar(chr(slot))\n\n\nheart = [0, 10, 31, 31, 14, 4, 0, 0]\nsmile = [0, 10, 10, 0, 17, 14, 0, 0]\nshow(0, heart)\nlcd.custom_char(1, smile)\nprint(sum(heart), smile)\n',
  },
  {
    name: 'n01 made legal: one function, lists of decimal numbers at both calls',
    source: 'def avg(values):\n    return sum(values) / len(values)\n\nt = [20.0, 21.0, 22.0]\nprint(avg(t))\nt2 = [1.5, 2.5]\nprint(avg(t2))\n',
  },
  // GCC ends a // comment at a carriage return: the rest of the docstring line would be C++ on the board only
  {
    name: 'a docstring with \\r',
    source: 'def ask():\n    """Wait for Enter (\\r or \\n), then return the line.\\rlong hidden() { return 7; }"""\n    return input()\n\n\nprint(ask())\n',
  },
  { name: 'shifts by a count worked out while running', source: 'n = 3\nprint(1 << n, -8 >> n)\nv = 1\nv <<= n\nprint(v)\n' },
  {
    name: 'map_range() and math with values worked out while running',
    source: 'import math\nfrom zero1 import map_range\n\nx = 4\nprint(map_range(x, 0, x, 0, 100), math.sqrt(x), math.log(x), math.asin(x / 8))\n',
  },
];

/** Programs the checker refuses since a C++ array parameter has one item type (§2.9): they compiled for the simulator only. */
export const PARAM_KIND_CASES: ReadonlyArray<{ name: string; source: string; line: number }> = [
  { name: 'n01: a list of whole numbers and a list of decimal numbers', source: 'def avg(values):\n    return sum(values) / len(values)\n\nt = [20, 21, 22]\nprint(avg(t))\nt2 = [1.5, 2.5]\nprint(avg(t2))\n', line: 7 },
  { name: 'n02: a list of whole numbers and a list of True / False', source: 'def total(v):\n    return sum(v)\n\nx = [1, 2, 3]\ny = [True, False]\nprint(total(x))\nprint(total(y))\n', line: 7 },
];
