# Upload to board — compiling and flashing from the browser

The **Upload to board** button (header, after *Arduino IDE*) compiles the
student's sketch inside the browser tab and sends it to the ZERO1 board over
the USB cable. No Arduino IDE, no server: everything happens on the student's
computer. This document explains how it works, what it needs, how the teacher
checks it on a real board, and how the compiler is published.

## 1. How it works

```
 sketch (.ino) ──worker──▶ .ino.cpp ─cc1plus.wasm─▶ .s ─avr-as.wasm─▶ .o ─avr-ld.wasm─▶ .elf ─avr-objcopy.wasm─▶ Intel HEX
                                                    (+ core.a, libs/*.a precompiled at build time)
 Intel HEX ──Web Serial (115200 baud, DTR reset)──▶ Optiboot on the ATmega328P: STK500v1, 128-byte pages, read-back verify
```

| Piece | Where | What |
|---|---|---|
| Compiler | `public/toolchain/tools/` (`cc1plus`, `avr-as`, `avr-ld`, `avr-objcopy` as `.wasm` + Emscripten `.mjs` glue) | GCC 7.3.0 and binutils 2.42 for AVR, built to WebAssembly by `tools/avr-toolchain-wasm/` and published as a GitHub release (§5). About 13 MB raw, 4.5 MB gzip; downloaded once and kept in the browser's Cache API. |
| Bundle | `public/toolchain/bundle/` | Arduino AVR core 1.8.6 (`core.a`), the libraries (`libs/*.a`), every header (`headers.bin`), avr-libc and `libgcc` (`sys/`), all precompiled at build time by `tools/build-toolchain-bundle.mjs` with the official `platform.txt` flags minus `-flto`. Sizes and licences in `manifest.json`. |
| Worker | `src/upload/toolchain/worker.ts` | A module Web Worker: downloads the tools with `WebAssembly.compileStreaming` (progress events), keeps the compiled modules, runs one fresh instance per tool call, answers `build` messages. The page never freezes. |
| Build | `src/upload/toolchain/{ino,arduino-build,diagnostics}.ts` | `.ino` → `.cpp` with prototypes and `#line` directives (identical to arduino-cli's output), the four tool calls with the exact `avr-g++ -###` arguments from the bundle manifest, `avr-size`-style sizes, gcc/ld messages mapped to `.ino` lines with plain-English hints. |
| Uploader | `src/upload/serial/` | Intel HEX parser, STK500v1 client, Web Serial adapter: DTR/RTS reset (250 ms low, 100 ms high), one `GET_SYNC` in flight with a 500 ms timeout (Optiboot's LED-flash window), 115200 then 57600 (old ATmegaBOOT), full 0xFF-padded pages, read-back verify, abort, stable error codes. |
| UI | `src/upload/ui/upload-dialog.ts`, `src/upload/upload.css` | The dialog: *Downloading the compiler* → *Compiling* (with "Sketch uses X bytes (Y%)") → *Choose your board* → *Uploading (page x of y)* → *Done*. Compile errors list the line and a hint and go to the console. |
| API | `src/upload/service.ts`, `src/upload/index.ts` | `detectUploadSupport()`, `UploadService` (`prepare`, `build`, `requestPort`, `upload`), `installUploadButton()`. |

The sketch is compiled without link-time optimisation (the wasm linker has no
LTO plugin), so it is 3–45 % bigger than the Arduino IDE's build (median
+19 %) and behaves identically; the biggest example uses a third of the flash.

### Feature detection

The button is always shown (except in the teacher's review frame). Uploading
works only when **all** of these hold: `navigator.serial` exists (Chrome, Edge,
Opera on Windows, macOS, Linux and ChromeOS), the page is a secure context,
WebAssembly is enabled, module workers work, and `toolchain/manifest.json` was
published with the site (§5). Otherwise a click opens a short dialog that says
why (for example *This browser cannot send a program to the board over USB:
uploading works in Chrome or Edge on a computer.*), what to do instead, and that
the *Arduino IDE* dialog remains the way to the board
(`src/upload/ui/unsupported-dialog.ts`). An earlier version hid the button in
those browsers, and teachers looking in Firefox, Safari or on a tablet could not
find it at all.

## 2. Browser and operating-system support

| | Chrome / Edge / Opera (desktop, ChromeOS) | Firefox | Safari | Phones and tablets |
|---|---|---|---|---|
| Upload to board | **yes** (Chrome ≥ 89) | no (no Web Serial) | no | no (Android Chrome has Web Serial for Bluetooth only) |
| Simulator | yes | yes | yes | yes |

Managed school Chromebooks: the administrator may have to allow Web Serial
(Chrome policy `DefaultSerialGuardSetting` = 1, or `SerialAllowUsbDevicesForUrls`
for the site with vendor `0x1A86` product `0x7523`). An iframe embedding the
simulator needs `allow="serial"`.

### USB-serial drivers

Most ZERO1 boards use a WCH CH340 chip (USB id `1A86:7523`); some have an FTDI
FT232R (`0403:6001`; on Windows its hardware id reads `FTDIBUS\COMPORT&VID_0403&PID_6001`
and the port *USB Serial Port (COMx)*). FTDI drivers are built into Windows
(Windows Update), macOS and Linux; the Windows package is at
<https://ftdichip.com/drivers/vcp-drivers/>. If the Arduino IDE sees the board,
its driver is installed. The table is for the CH340:

| OS | Driver |
|---|---|
| Windows 10 / 11 | usually installed by Windows Update on first plug-in (the port appears as *USB-SERIAL CH340 (COMx)*); otherwise WCH's CH341SER.EXE from <https://www.wch-ic.com/downloads/CH341SER_EXE.html> (needs administrator rights: on school computers, the IT team) |
| macOS 13 or newer | built in |
| macOS 12 and older | WCH driver from <https://www.wch-ic.com/downloads/CH341SER_MAC_ZIP.html> |
| Linux | in the kernel (`ch341`); the user must be in the `dialout` group (`sudo usermod -aG dialout $USER`, then log out and in), and `brltty` must be removed on Ubuntu (it grabs CH340 ports) |
| ChromeOS | built in |

The board chooser lists the usual USB-serial chips of UNO-type boards (every WCH
chip, Arduino, FTDI, CP2102: `UNO_USB_FILTERS` in `src/upload/serial/webserial.ts`).
Before this list, the chooser listed only CH340 `1A86:7523`, CH9102 and two
Arduino ids, and an FTDI ZERO1 board (`0403:6001`) never appeared, although the
Arduino IDE saw it.
When it closes without a board, the Upload dialog opens **My board is not in the
list**: use a data cable and another USB port, close the Arduino IDE, the driver
line for this computer (Windows: "If the Arduino IDE sees the board, its driver
is installed", then *CH340 driver for Windows* and *FTDI driver for Windows* buttons;
macOS 13+, ChromeOS, Linux: no driver needed), and **Show every serial port…**,
which opens the chooser with no filter. A web page can neither install a driver
nor see whether one is installed (on Windows, without the driver the board has
no COM port and Web Serial lists nothing): it can only put the download one
click away, on the system the browser reports.

## 3. What the student sees

1. **Upload to board** → the dialog opens and, the first time on this computer,
   downloads the compiler (*Downloading the compiler (once, about 6 MB)*; 3 s on
   a 20 Mbit/s line, then instant from the cache).
2. *Compiling*: 0.3–3 s (slow Chromebooks). Then the Arduino IDE's lines
   *Sketch uses X bytes (Y%) of program storage space* and *Global variables use…*.
3. *Choose your board* → the browser's port chooser opens listing
   *USB-SERIAL CH340* (and Arduino UNO boards); **Connect**.
4. *Uploading (page x of y)* → *Done — the sketch is running on the board*
   (1–3 s for a typical sketch).

Errors are in plain English with a help line, and *Details* shows the raw
compiler or protocol output. Compile errors name the `.ino` line and appear in
the console too. A sketch that compiles in the simulator but not with GCC (a
missing `#include <Servo.h>`, `"text" + number`, ...) is reported at this stage.

## 4. The 10-minute hardware test (teacher, one ZERO1 board)

Needed: a ZERO1 board, a laptop with Chrome or Edge, a USB cable, the site
(or `npm run dev` with the toolchain built, §5), a second person writing down
the times. Everything below was verified only on an emulated board: the
"expect" values are what to compare with.

| Min | Step | Write down |
|---|---|---|
| 0 | Plug in the board. Open the simulator, load *Examples › Blink the red LED*, click **Upload to board**. | The chooser's port name (expect *USB-SERIAL CH340 (COMx)* / `/dev/cu.usbserial-…`), the OS and browser version |
| 1 | Wait for *Done*. Open *Details*. | "bootloader 4.4" (expect 4.4), "115200 baud", the total ms (expect 1–3 s), any "sync … try 2" lines |
| 2 | Look at the board. | The red LED (A1) blinks once per second? Serial Monitor of the simulator is not involved. |
| 3 | Load *Buzzer melody*, upload. | Time; the melody plays? |
| 4 | Load *Smart greenhouse* (needs the DHT22 and LCD plugged in), upload. | Time; the LCD shows *T:..C H:..%* and the fan line? The sketch should use about 8,800 bytes |
| 5 | Upload again and **unplug the USB cable** while the pages count up. | Expect *Upload failed* with "Lost the connection to the board" (code PORT) |
| 6 | Open the Arduino IDE's Serial Monitor on the same port, then click Upload. | Windows: expect "used by another program"; macOS/Linux: expect "No answer from the board — is the Arduino IDE Serial Monitor…". Close the monitor. |
| 7 | Click Upload; while *Connecting to the board…* shows, **press the RESET button** on the board. | Does it still sync? (the manual-reset path) |
| 8 | In the Arduino IDE, upload any sketch the usual way. | Still works? (the bootloader is untouched) |
| 9 | Load *Smart greenhouse* again, Upload, note the compile stage. | First compile ms vs second compile ms (expect < 1 s warm) |
| 10 | On a school Chromebook, repeat steps 0–2. | The chooser works? Times? |

Send the numbers and the *Details* text to the maintainers; anything that
deviates from an "expect" value goes to the issue tracker.

## 5. Building and publishing the compiler

The `.wasm` tools are GPL-3.0 programs: the site ships them together with a
link to their corresponding source (`tools/avr-toolchain-wasm/`, and the
notices page `public/THIRD_PARTY_NOTICES.md` linked from the dialog).

### Publish a toolchain release (once, and after every toolchain change)

The workflow is `.github/workflows/avr-toolchain-wasm.yml` (a copy is kept in
`tools/avr-toolchain-wasm/.github-workflow.yml`; keep the two identical). It runs
when a tag `avr-toolchain-wasm-v…` is pushed, and a release published from the
GitHub website creates and pushes its tag. Use a new version number each time
(v1.0.1, v1.0.2, …): a tag made before a fix still points at the old code.

1. On GitHub: **Releases → Draft a new release → Choose a tag**, type the new tag
   exactly (for example `avr-toolchain-wasm-v1.0.1`), choose **Create new tag on
   publish**, leave the target on `main`, give it a title, and click **Publish
   release** (not *Save draft*: a draft creates no tag, so nothing runs).
2. **Actions → avr-toolchain-wasm** shows a run for that tag. It builds twice in
   Docker (about 20 minutes), checks that both builds are byte-identical, compiles
   a C++ and a C function through all five tools (`tools/avr-toolchain-wasm/test/smoke.mjs`),
   then attaches `*.wasm`, `*.mjs`, `SHA256SUMS` and `SOURCES.txt` to the release
   (it also replaces the release description with its own text).
3. When that run succeeds, **Build, test and deploy to GitHub Pages** starts by
   itself (`workflow_run`), picks up the newest `avr-toolchain-wasm-v*` release
   (`tools/fetch-toolchain.mjs`), verifies `SHA256SUMS`, records the tag in
   `public/toolchain/manifest.json` (`release`) and deploys. Its *Toolchain status*
   step prints `Upload feature ON: <tag>`; a deploy started this way fails instead
   of deploying without the compiler. A deploy started any other way (a push to
   `main`, *Run workflow*) only warns when no usable release exists.

Never turn a release that has its files back into a draft and publish it again:
the newest published release wins, so an empty one would switch Upload off again.
Deleting an old release without files is harmless.

### The site build

`npm run build` runs, in order:

1. `tools/build-toolchain-bundle.mjs`: clones the pinned Arduino core and
   libraries (GitHub, cached in `node_modules/.cache/`), compiles them with the
   native `avr-gcc` 7.3.0 (`apt-get install gcc-avr avr-libc binutils-avr`) into
   `public/toolchain/bundle/`. Without `avr-gcc` it prints a warning and the
   feature is off.
2. `tools/fetch-toolchain.mjs`: the wasm tools from `$ZERO1_TOOLCHAIN_DIR`
   (a local build), `$ZERO1_TOOLCHAIN_URL` / `$ZERO1_TOOLCHAIN_TAG`, or the
   newest release; writes `public/toolchain/manifest.json`. Without a release
   or without the bundle of step 1 it removes the manifest and `tools/`, and
   the build still succeeds (the site then has no compiler of its own).
3. `tsc`, `vite build` (`public/toolchain/` is copied as is; `.gitignore`d),
   `scripts/check-bundle.mjs`.

Local development: `ZERO1_TOOLCHAIN_DIR=/path/to/toolchain/out npm run build`
or `npm run toolchain:bundle && ZERO1_TOOLCHAIN_DIR=… npm run toolchain:fetch`
once, then `npm run dev` (Vite serves `public/` directly; the feature works on
`localhost`, a secure context).

### Other hosts (Vercel)

The repository is also deployed by Vercel, whose build machines have no
`avr-gcc`: its builds have no bundle, hence no `toolchain/` of their own.
`vercel.json` therefore proxies `/toolchain/*` to the GitHub Pages site
(`https://ebechalani.github.io/zero1smartboard/toolchain/*`, an external
rewrite: the browser still sees the Vercel address, so the worker's fetches
stay same-origin). Upload to board then works on the Vercel address too, with
the compiler built and tested by the GitHub deploy; nothing extra to publish.
Before this, the Vercel copy never showed Upload (a teacher used that address).

### Tests

| Command | What |
|---|---|
| `npm test` | Unit tests of the HEX parser, STK500 client (15 failure paths on a fake bootloader), Web Serial adapter, `.ino` preprocessing against arduino-cli golden files, diagnostics, build pipeline; the dialog in happy-dom with a fake service; a quick end-to-end upload of blink into the real Optiboot 4.4 running on avr8js, and the 57600 fallback; the wasm toolchain compiling blink in Node to the pinned HEX (skipped without the toolchain). |
| `npm run test:hardware-sim` | The long emulator suites: full 32 KB images, USB latency, abort/recover; the LCD, DHT and ultrasonic examples compiled by the wasm toolchain against our MIT LiquidCrystal_I2C / NewPing and run on the emulated board, compared with the reference screens and distances. |

### Licences

`public/THIRD_PARTY_NOTICES.md` (served with the site, linked from the dialog)
lists everything shipped: GCC/binutils (GPL-3.0, with the corresponding source
in `tools/avr-toolchain-wasm/`), the Arduino core and Wire/Servo (LGPL-2.1),
NeoPixel (LGPL-3.0), DHT (MIT), Adafruit_Sensor (Apache-2.0), avr-libc (BSD),
and our own MIT `LiquidCrystal_I2C` and `NewPing` (`tools/arduino-libs/`),
which replace the unlicensed / no-derivatives originals with the same API.

## 6. Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| No **Upload to board** button | Firefox/Safari/phone; or the site was deployed without a toolchain release; or Web Serial is blocked by policy | Use Chrome or Edge on a computer; check `toolchain/manifest.json` on the site; ask the Chromebook administrator (§2) |
| *Downloading the compiler* never finishes | Slow line, or a proxy blocking `.wasm` files (13 MB) | Wait; try another network; the download resumes from the cache on the next try |
| *The compiler could not start* | The `.wasm` files were not deployed, or an ad-blocker/extension blocks workers | Check `toolchain/tools/cc1plus.wasm` loads; try an incognito window |
| Compile error the simulator did not show | GCC is stricter than the simulator: missing `#include`, `"text" + 5`, `Serial.printf`, 4-argument `tone()` | Follow the hint under the error; fix the sketch |
| *The sketch is too big* | More than 32,256 bytes without LTO | Remove unused libraries or code |
| No port in the chooser | Driver missing (macOS < 13, Linux `dialout`), bad cable (charge-only), board not powered | §2; try another cable/port; on Linux check `dmesg` for `ch341-uart` |
| *No answer from the board* (NO_ANSWER) | The Arduino IDE Serial Monitor or another tab holds the port; wrong port; the auto-reset did not work | Close the monitor and other tabs; pick *USB-SERIAL CH340*; press RESET on the board while *Connecting…* shows |
| *The board answered, but not like an Arduino bootloader* (NOT_IN_SYNC) | The running sketch prints on Serial and the reset did not happen (DTR not wired) | Press RESET right after clicking *Choose the board*; unplug/replug |
| *…is being used by another program* (PORT, Windows) | Another program has the COM port open | Close the Arduino IDE (Serial Monitor/Plotter), other browsers, PuTTY… |
| *Lost the connection to the board* (PORT) | Cable pulled, USB hub reset | Replug and upload again (the board holds an incomplete program until then) |
| *This board does not look like an Arduino UNO* (SIGNATURE_MISMATCH) | Another board was chosen | Choose the CH340 port |
| *Verification failed* (VERIFY_FAILED) | Flash write failed, damaged board, bad cable | Retry; another cable; the Arduino IDE gives the same |
| Upload works, the Arduino IDE later says "not in sync" | Unrelated: the IDE's own port selection | Choose the port in the IDE's Tools menu |
| Old Nano-style board with ATmegaBOOT | Handled: the uploader falls back to 57600 baud and the 30,720-byte limit | nothing |
