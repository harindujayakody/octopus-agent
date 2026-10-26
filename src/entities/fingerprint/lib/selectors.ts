import { useMemo } from "react";
import type { FingerprintEntry } from "../model/types";
import { useFingerprint } from "./useFingerprint";
import { filterFingerprints, fingerprintOs } from "./facets";

/// The entries the search and filters keep.
export function useVisibleFingerprints() {
    const items = useFingerprint((s) => s.items);
    const search = useFingerprint((s) => s.search);
    const filters = useFingerprint((s) => s.filters);
    return useMemo(() => filterFingerprints(items, search, filters), [items, search, filters]);
}

/// The visible entries grouped by OS (macOS, Windows, Linux, Android, then others).
export function useVisibleFingerprintGroups() {
    const visible = useVisibleFingerprints();
    return useMemo<ReadonlyArray<readonly [string, FingerprintEntry[]]>>(() => {
        const order = ["macOS", "Windows", "Linux", "Android"];
        const buckets = new Map<string, FingerprintEntry[]>();
        for (const it of visible) {
            const k = fingerprintOs(it) || "Other";
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k)!.push(it);
        }
        return [
            ...order.filter((k) => buckets.has(k)).map((k) => [k, buckets.get(k)!] as const),
            ...[...buckets.keys()].filter((k) => !order.includes(k)).map((k) => [k, buckets.get(k)!] as const),
        ];
    }, [visible]);
}
