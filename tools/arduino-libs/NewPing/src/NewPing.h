/*
  NewPing — ZERO1 Smart Board edition
  -----------------------------------
  Drives an HC-SR04 style ultrasonic sensor (10 us trigger pulse, echo pulse
  proportional to the distance) with the same class and method names as Tim
  Eckel's NewPing library, whose licence allows no derivative works, so that a
  sketch written for it compiles and behaves the same on the real board and in
  the ZERO1 simulator: ping(), ping_cm(), ping_in(), ping_median(),
  convert_cm(), convert_in() and the usual constants. Written from the sensor
  datasheet. The timer-interrupt API of the original (ping_timer, check_timer,
  timer_us, timer_ms, timer_stop) is not provided.

  Copyright (c) 2026 ZERO1 Smart Board simulator contributors
  SPDX-License-Identifier: MIT (see LICENSE)
*/
#ifndef NewPing_h
#define NewPing_h

#include <Arduino.h>

#define MAX_SENSOR_DISTANCE 500  // cm: sound needs about 29 ms for 5 m and back; no point waiting longer
#define US_ROUNDTRIP_CM 57       // microseconds of echo per centimetre of distance (there and back)
#define US_ROUNDTRIP_IN 146      // microseconds of echo per inch of distance
#define NO_ECHO 0                // returned when no echo came back within the maximum distance
#define MAX_SENSOR_DELAY 5800    // microseconds a sensor may take to start the echo after the trigger
#define PING_MEDIAN_DELAY 29     // milliseconds between the pings of ping_median()
#define TRIGGER_WIDTH 10         // microseconds the trigger pin is held HIGH

/** Round-trip microseconds → distance units, rounding to the nearest (like the original's optional rounding). */
#define NewPingConvert(echoTime, conversionFactor) (max(((unsigned int)(echoTime) + (conversionFactor) / 2) / (conversionFactor), ((echoTime) ? 1 : 0)))

class NewPing {
public:
  /** trigger_pin / echo_pin: Arduino pin numbers (ZERO1: TRIG D3, ECHO D2); max_cm_distance: ignore echoes farther than this. */
  NewPing(uint8_t trigger_pin, uint8_t echo_pin, unsigned int max_cm_distance = MAX_SENSOR_DISTANCE);

  /** One measurement: echo time in microseconds, or NO_ECHO. max_cm_distance = 0 keeps the constructor's limit. */
  unsigned int ping(unsigned int max_cm_distance = 0);
  /** One measurement in whole centimetres (truncated), 0 = no echo. */
  unsigned long ping_cm(unsigned int max_cm_distance = 0);
  /** One measurement in whole inches (truncated), 0 = no echo. */
  unsigned long ping_in(unsigned int max_cm_distance = 0);
  /** Median echo time of `it` pings taken PING_MEDIAN_DELAY apart, ignoring the ones without echo. */
  unsigned long ping_median(uint8_t it = 5, unsigned int max_cm_distance = 0);

  static unsigned int convert_cm(unsigned int echoTime);
  static unsigned int convert_in(unsigned int echoTime);

protected:
  /** Send the trigger pulse and wait for the echo to start. False when the sensor did not answer. */
  boolean ping_trigger();
  void set_max_distance(unsigned int max_cm_distance);

  uint8_t _triggerBit;
  uint8_t _echoBit;
  volatile uint8_t *_triggerOutput;
  volatile uint8_t *_echoInput;
  volatile uint8_t *_triggerMode;
  unsigned int _maxEchoTime;
  unsigned long _max_time;
};

#endif
