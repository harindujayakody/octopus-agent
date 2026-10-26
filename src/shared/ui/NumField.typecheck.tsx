// Compile-time checks of NumField's contract (F11 fix round 2, Minor 4):
// `npm run check` (tsc) fails if a line marked @ts-expect-error compiles.
// Nothing imports this file, so it never reaches the bundle.
import { NumField } from "./NumField";

const on = (v: number) => void v;
const name = String(Math.random());
const maybe = null as number | null;

export const named = [
  <NumField key="label" label={name} value={1} onChange={on} />,
  <NumField key="aria" aria-label={name} value={1} onChange={on} />,
  <NumField key="by" aria-labelledby={name} value={1} onChange={on} />,
  <NumField key="optional" label={name} value={maybe} onChange={on} onClear={() => {}} />,
];

export const refused = [
  // @ts-expect-error a field with no name
  <NumField key="unnamed" value={1} onChange={on} />,
  // @ts-expect-error a value that may be empty, with nothing to do when emptied
  <NumField key="no-clear" label={name} value={maybe} onChange={on} />,
  // @ts-expect-error named twice
  <NumField key="twice" label={name} aria-label={name} value={1} onChange={on} />,
];
