import { Button, Tooltip } from "@proxyshard/shardx-ui-kit";
import { PropertyRow } from "../../../../shared/ui/peek";
import { useT } from "../../../../shared/i18n";
import { FileTooBig, MB, pickTextFile } from "../../../../shared/lib/pickFile";
import { toast } from "../../../../shared/model/toast";

export type PickedCookies = { name: string; items: unknown[] };

/// Cookies to bring in with the profile: a JSON array exported from a browser
/// or another profile. Read now, imported once the profile is saved (and not
/// running), so a new profile can start already signed in.
export function CookiesRow({ value, onChange }: { value: PickedCookies | null; onChange: (v: PickedCookies | null) => void }) {
  const t = useT();
  const pick = async () => {
    try {
      const picked = await pickTextFile({ accept: ".json,application/json", maxBytes: 20 * MB });
      if (!picked) return;
      const items: unknown = JSON.parse(picked.text);
      if (!Array.isArray(items)) { toast.err(t("useProfile.cookiesNotArray")); return; }
      onChange({ name: picked.name, items });
    } catch (e) {
      toast.fail({ title: t("profileForm.cookiesReadFailed"), detail: e instanceof FileTooBig ? e.message : e });
    }
  };
  return (
    <PropertyRow id="cookies" label={t("profileForm.cookies")}>
      {() => (
        <div className="flex min-w-0 items-center gap-1.5 px-1.5 py-1">
          {value && (
            <Tooltip content={value.name} whenTruncated>
              <span className="min-w-0 truncate text-ui text-text-strong-950">{value.name}</span>
            </Tooltip>
          )}
          <Button variant="neutral" mode="stroke" size="2xsmall" onClick={() => void pick()}>
            {value ? t("profileForm.cookiesChange") : t("profileForm.cookiesLoad")}
          </Button>
          {value && (
            <Button variant="neutral" mode="ghost" size="2xsmall" onClick={() => onChange(null)}>
              {t("profileForm.cookiesRemove")}
            </Button>
          )}
        </div>
      )}
    </PropertyRow>
  );
}
