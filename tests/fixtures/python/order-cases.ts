/**
 * Python programs and what CPython 3.12 prints for them (input() echoes the typed line like the
 * board): Python's order of evaluation (docs/PYTHON.md §4.7 E4), list indexes and numbers.
 */
export const ORDER_CASES: ReadonlyArray<{ name: string; source: string; input: string; cpython: string[] }> = [
  {
    name: 'two input() in one text: the first question first',
    source: 'full = input("First name? ") + " " + input("Last name? ")\nprint(full)\n',
    input: 'Ada\nLovelace\n',
    cpython: ['First name? Ada', 'Last name? Lovelace', 'Ada Lovelace'],
  },
  {
    name: 'input() in the arguments of an own function, of min() and in an f-string',
    source: 'def show(a, b):\n    print(a, b)\nshow(input("A? "), input("B? "))\nprint(min(int(input("a? ")), int(input("b? "))))\ntext = f"{input(\'p? \')} and {input(\'q? \')}"\nprint(text)\n',
    input: 'x\ny\n3\n9\nP\nQ\n',
    cpython: ['A? x', 'B? y', 'x y', 'a? 3', 'b? 9', '3', 'p? P', 'q? Q', 'P and Q'],
  },
  {
    name: 'print() works out its values before it prints',
    source: 'def ask():\n    return int(input("Number? "))\ndef dbg(n):\n    print("dbg", n)\n    return n\nprint("Hello", input("Name? "))\nprint("Double:", ask() * 2)\nprint(f"Hi {input(\'Name? \')}, you are {input(\'Age? \')}")\nprint(dbg(1), dbg(2))\n',
    input: 'Bob\n21\nAnn\n9\n',
    cpython: ['Name? Bob', 'Hello Bob', 'Number? 21', 'Double: 42', 'Name? Ann', 'Age? 9', 'Hi Ann, you are 9', 'dbg 1', 'dbg 2', '1 2'],
  },
  {
    name: 'keyword arguments in the order written',
    source: 'def greet(name, greeting):\n    print(greeting + ", " + name)\ngreet(greeting=input("Greeting? "), name=input("Name? "))\n',
    input: 'Hi\nAnn\n',
    cpython: ['Greeting? Hi', 'Name? Ann', 'Hi, Ann'],
  },
  {
    name: 'an index with effects in lst[i] op= v is worked out once',
    source: 'votes = [0, 0, 0]\nfor i in range(3):\n    votes[int(input("Vote 0-2? "))] += 1\nprint(votes)\ndef k():\n    print("k")\n    return 1\nlst = [5, 6]\nlst[k()] //= 2\nlst[k()] **= 2\nlst[k()] %= 4\nprint(lst)\n',
    input: '1\n2\n1\n',
    cpython: ['Vote 0-2? 1', 'Vote 0-2? 2', 'Vote 0-2? 1', '[0, 2, 1]', 'k', 'k', 'k', '[5, 1]'],
  },
  {
    name: 'True and False as list indexes; -0.0; round(x, n) sends halves to the even number',
    source: 'a = [1, 2]\nprint(a[True], a[False])\nb = [10, 20]\nb[True] = 7\nprint(b)\nx = 0.0\nprint(-x, 0.0 * -5, round(-0.4, 0), round(1.25, 1), round(0.125, 2), round(2.5, 0))\n',
    input: '',
    cpython: ['2 1', '[10, 7]', '-0.0 -0.0 -0.0 1.2 0.12 2.0'],
  },
  {
    name: 'shifts by a count worked out while running',
    source: 'for s in [0, 5, 30, 31, 32, 40, 200]:\n    print(s, 1 << s % 31, -1024 >> s, 1024 >> s)\n',
    input: '',
    cpython: ['0 1 -1024 1024', '5 32 -32 32', '30 1073741824 -1 0', '31 1 -1 0', '32 2 -1 0', '40 512 -1 0', '200 16384 -1 0'],
  },
];
