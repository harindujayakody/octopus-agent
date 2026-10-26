import { useEffect, useMemo, useState } from "react";
import { automationFleet } from "../model/api";
import type { RunState } from "../model/types";

/** How many profiles each project's run is on right now: its workers that
 *  are starting or running. A project with no run going is not in the map. */
export type RunningOn = ReadonlyMap<string, number>;

/** How a run that is over ended, and when (ms). */
export type LastRun = { outcome: "finished" | "failed" | "stopped"; at: number };

/** Each project's last run since the launcher started: the fleet keeps a run
 *  after it ends, until the project runs again. A project with a run going,
 *  or none yet this session, is not in the map. */
export type LastRuns = ReadonlyMap<string, LastRun>;

const NONE: RunningOn = new Map();
const NO_RUNS: LastRuns = new Map();

/** The runner stamps each log line "[seconds] text"; the last one is when the run ended. */
const STAMP = /^\[(\d+)\]/;

/** A run that is over: failed if any worker failed, else stopped if the operator stopped it, else finished. It ended at its last log line (the start, when it has none). */
export function lastRunOf(r: RunState): LastRun {
  const outcome = r.workers.some((w) => w.status === "failed") ? "failed" : r.workers.some((w) => w.status === "stopped") ? "stopped" : "finished";
  const stamp = STAMP.exec(r.log[r.log.length - 1] ?? "")?.[1];
  return { outcome, at: (stamp ? Number(stamp) : r.started_at) * 1000 };
}

/// The fleet as the Fleet monitor polls it, for a list that shows which
/// projects are running, and how the last run of the others ended. It polls
/// while mounted (every 1.5 s), and `refresh` asks at once (right after a Run
/// or a Stop).
export function useRunningOn(): { running: RunningOn; last: LastRuns; refresh: () => void } {
  const [runs, setRuns] = useState<RunState[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const read = () => { automationFleet().then((r) => { if (alive) setRuns(r); }).catch(() => {}); };
    read();
    const id = setInterval(read, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [tick]);
  const running: RunningOn = useMemo(() => {
    const live = runs.filter((r) => r.running);
    return live.length === 0
      ? NONE
      : new Map(live.map((r) => [r.project_id, r.workers.filter((w) => w.status === "starting" || w.status === "running").length]));
  }, [runs]);
  const last: LastRuns = useMemo(() => {
    const over = runs.filter((r) => !r.running);
    return over.length === 0 ? NO_RUNS : new Map(over.map((r) => [r.project_id, lastRunOf(r)]));
  }, [runs]);
  return { running, last, refresh: () => setTick((n) => n + 1) };
}
