#!/usr/bin/env bash
# Run `maestro test` and treat functional pass + finalize crash/hang as success.
#
# Maestro 2.x sometimes prints "Flow Passed" then hangs or throws
# NoSuchFileException while zipping ~/Library/Logs/maestro — exit 1 with no
# assertion failure. Serial fleet runners source this wrapper for single flows.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: maestro-flow-run.sh maestro test …" >&2
  exit 1
fi

_flow_log="$(mktemp "${TMPDIR:-/tmp}/maestro-flow.XXXXXX")"
_rc=1
_max_wait="${MAESTRO_FLOW_MAX_WAIT_SEC:-900}"
# Kill a flow that stops producing output entirely — the iOS driver failing to
# come up leaves `maestro test` blocked with a silent log forever, which neither
# _max_wait (too coarse for a 76-flow serial suite) nor the caller's
# failure-pattern retry can see. Log is cat'd at the end, so nothing is lost.
_stall_max="${MAESTRO_FLOW_MAX_STALL_SEC:-420}"

# Redirect rather than pipe to tee: `$!` on a pipeline is the PID of its LAST
# element, so the old `… | tee &` handed the watchdog tee's PID. `kill "$_mp"`
# then killed tee while the maestro JVM kept running and holding the simulator —
# a hung flow stalled the whole suite indefinitely (observed 2026-08-10: 30min+
# on budget-prime-session with the watchdog never firing).
set +e
"$@" >"${_flow_log}" 2>&1 &
_mp=$!
set -e

# The device THIS invocation targets, parsed from the caller's own `--device
# <udid>` argument so _hard_kill can scope its JVM sweep to it.
_device_udid=""
_prev_arg=""
for _arg in "$@"; do
  if [[ "${_prev_arg}" == "--device" ]]; then
    _device_udid="${_arg}"
    break
  fi
  _prev_arg="${_arg}"
done

# Maestro spawns xcrun/idb children; killing only the JVM leaves them attached
# to the device. Take out the whole tree, then belt-and-braces the JVM by name.
#
# THE JVM SWEEP IS SCOPED TO THIS RUN'S DEVICE, and that is not cosmetic. It used
# to be a bare `pkill -9 -f 'maestro.cli.AppKt'`, justified by "the suite is
# serial — at most one maestro run is live at a time". That is true INSIDE Budget
# and false on the machine: House, Kaizen, Language, Health and other repos run
# their own maestro JVMs against their own simulators concurrently, and an
# unscoped pkill takes every one of them down mid-flow. The victim sees its run
# die with exit 143 and no failing assertion, which reads as a broken suite and
# is nothing of the kind — observed 2026-09-09, when this line killed a House of
# Commons suite twice from here.
#
# maestro-scoped-kill.sh's header names this exact command as the thing never to
# do; this is that rule applied at the one call site that still broke it. Falling
# back to no sweep when the UDID cannot be parsed is deliberate: leaving one
# stray JVM behind is recoverable, killing another suite's run is not.
_hard_kill() {
  pkill -P "${_mp}" 2>/dev/null || true
  kill "${_mp}" 2>/dev/null || true
  sleep 2
  pkill -9 -P "${_mp}" 2>/dev/null || true
  kill -9 "${_mp}" 2>/dev/null || true
  if [[ -n "${_device_udid}" ]]; then
    pkill -9 -f "maestro\.cli\.AppKt.*${_device_udid}" 2>/dev/null || true
  fi
}

_elapsed=0
_stall=0
_last_size=0
while kill -0 "${_mp}" 2>/dev/null; do
  if grep -qE '(\[Passed\][^(]*\(|Flow Passed|1/1 Flow Passed)' "${_flow_log}" 2>/dev/null; then
    _rc=0
  fi
  if [[ "${_rc}" -eq 0 ]]; then
    sleep 2
    if ! kill -0 "${_mp}" 2>/dev/null; then
      break
    fi
    if grep -qE 'NoSuchFileException.*Library/Logs/maestro|DebugLogStore\.finalizeRun' "${_flow_log}" 2>/dev/null; then
      _hard_kill
      break
    fi
  fi
  if grep -qE 'Assertion is false:|Flow Failed|^[[:space:]]*\[Failed\][[:space:]]+[a-z0-9-]+[[:space:]]*\(' "${_flow_log}" 2>/dev/null \
    && ! grep -qE '(Flow Passed|1/1 Flow Passed|\[Passed\])' "${_flow_log}" 2>/dev/null; then
    break
  fi
  sleep 2
  _elapsed=$((_elapsed + 2))

  # Silence watchdog. "IOSDriverTimeoutException" is deliberate wording: the
  # serial suite runner greps the flow tail for it to retry the flow after a
  # cooldown instead of scoring a hang as a real assertion failure.
  _size="$(wc -c <"${_flow_log}" 2>/dev/null || echo 0)"
  if [[ "${_size}" == "${_last_size}" ]]; then
    _stall=$((_stall + 2))
  else
    _stall=0
    _last_size="${_size}"
  fi
  if ((_stall >= _stall_max)); then
    echo "IOSDriverTimeoutException: no output for ${_stall_max}s — maestro-flow-run watchdog killed the run" >>"${_flow_log}"
    _hard_kill
    break
  fi

  if ((_elapsed >= _max_wait)); then
    echo "IOSDriverTimeoutException: no completion after ${_max_wait}s — maestro-flow-run watchdog killed the run" >>"${_flow_log}"
    _hard_kill
    break
  fi
done

wait "${_mp}" 2>/dev/null || true

if [[ "${_rc}" -eq 1 ]] && grep -qE '(\[Passed\]|Flow Passed|1/1 Flow Passed)' "${_flow_log}"; then
  _rc=0
fi
if [[ "${_rc}" -eq 1 ]] \
  && grep -qE 'NoSuchFileException.*Library/Logs/maestro|DebugLogStore\.finalizeRun' "${_flow_log}" \
  && grep -q 'COMPLETED' "${_flow_log}"; then
  _rc=0
fi

cat "${_flow_log}"
rm -f "${_flow_log}"
exit "${_rc}"
