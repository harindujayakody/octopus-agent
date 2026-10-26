import type { ProfileForm } from "../../../../entities/profile";

/** What every field group gets: the form and a setter for one of its fields. */
export type FieldProps = {
  f: ProfileForm;
  u: <K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) => void;
};
