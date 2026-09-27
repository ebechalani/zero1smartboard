/*
  NewPing — ZERO1 Smart Board edition (see NewPing.h)
  Copyright (c) 2026 ZERO1 Smart Board simulator contributors
  SPDX-License-Identifier: MIT
*/
#include "NewPing.h"

NewPing::NewPing(uint8_t trigger_pin, uint8_t echo_pin, unsigned int max_cm_distance) {
  // Direct port access: a digitalRead() costs a few microseconds, which would
  // blur the echo measurement (58 us per cm).
  _triggerBit = digitalPinToBitMask(trigger_pin);
  _echoBit = digitalPinToBitMask(echo_pin);
  _triggerOutput = portOutputRegister(digitalPinToPort(trigger_pin));
  _triggerMode = portModeRegister(digitalPinToPort(trigger_pin));
  _echoInput = portInputRegister(digitalPinToPort(echo_pin));
  set_max_distance(max_cm_distance);
  *_triggerMode |= _triggerBit;  // trigger pin as output
  pinMode(echo_pin, INPUT);
}

void NewPing::set_max_distance(unsigned int max_cm_distance) {
  // One centimetre of margin, capped at the sensor's range.
  unsigned int cm = max_cm_distance > MAX_SENSOR_DISTANCE ? MAX_SENSOR_DISTANCE : max_cm_distance;
  _maxEchoTime = (cm + 1) * US_ROUNDTRIP_CM;
}

boolean NewPing::ping_trigger() {
  // The echo of a previous ping (one that went beyond the limit) may still be
  // HIGH; the sensor ignores a trigger until it ends, so wait for it first.
  _max_time = micros() + _maxEchoTime + MAX_SENSOR_DELAY;
  while (*_echoInput & _echoBit) {
    if (micros() > _max_time) return false;
  }

  // A clean LOW, then the trigger pulse.
  *_triggerOutput &= ~_triggerBit;
  delayMicroseconds(4);
  *_triggerOutput |= _triggerBit;
  delayMicroseconds(TRIGGER_WIDTH);
  *_triggerOutput &= ~_triggerBit;

  // Wait for the echo pulse to start (most sensors need < 500 us).
  _max_time = micros() + MAX_SENSOR_DELAY;
  while (!(*_echoInput & _echoBit)) {
    if (micros() > _max_time) return false;
  }
  _max_time = micros() + _maxEchoTime;  // the echo started: it must end before the maximum distance
  return true;
}

unsigned int NewPing::ping(unsigned int max_cm_distance) {
  if (max_cm_distance > 0) set_max_distance(max_cm_distance);
  if (!ping_trigger()) return NO_ECHO;
  unsigned long start = _max_time - _maxEchoTime;
  while (*_echoInput & _echoBit) {
    if (micros() > _max_time) return NO_ECHO;  // farther than the maximum distance
  }
  return (unsigned int)(micros() - start);
}

unsigned long NewPing::ping_cm(unsigned int max_cm_distance) { return ping(max_cm_distance) / US_ROUNDTRIP_CM; }

unsigned long NewPing::ping_in(unsigned int max_cm_distance) { return ping(max_cm_distance) / US_ROUNDTRIP_IN; }

unsigned long NewPing::ping_median(uint8_t it, unsigned int max_cm_distance) {
  if (it == 0) it = 1;
  unsigned int samples[it];
  uint8_t n = 0;
  for (uint8_t i = 0; i < it; i++) {
    unsigned long t = millis();
    unsigned int us = ping(max_cm_distance);
    if (us != NO_ECHO) {
      // insertion into a list sorted in descending order
      uint8_t j = n;
      while (j > 0 && samples[j - 1] < us) {
        samples[j] = samples[j - 1];
        j--;
      }
      samples[j] = us;
      n++;
    }
    if (i + 1 < it) {
      unsigned long spent = millis() - t;
      if (spent < PING_MEDIAN_DELAY) delay(PING_MEDIAN_DELAY - spent);
    }
  }
  if (n == 0) return NO_ECHO;
  return samples[n >> 1];
}

unsigned int NewPing::convert_cm(unsigned int echoTime) { return echoTime / US_ROUNDTRIP_CM; }

unsigned int NewPing::convert_in(unsigned int echoTime) { return echoTime / US_ROUNDTRIP_IN; }
