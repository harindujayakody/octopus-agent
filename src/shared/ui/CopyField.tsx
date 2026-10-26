import { CopyButton, Input } from "@proxyshard/shardx-ui-kit";
import { useT } from "../i18n";
import { clip, copySecret } from "../lib/clipboard";
import { toast } from "../model/toast";

/// Read-only value with inline copy button — UI-kit Input + icon action.
/// `label` is the kit's field label; `mono` sets an address or a key in the
/// mono face (TYPE-08). The copy says "Copied" where the click was (EMIL-18);
/// a secret also says, in a toast, that it leaves the clipboard in a minute
/// (SEC-11): news the button cannot carry. A failure is a toast.
export function CopyField({ value, secret, label, mono, labelledBy, describedBy }: {
  value: string;
  secret?: boolean;
  label?: string;
  mono?: boolean;
  /** The id of a caption elsewhere that names it (a setting row's title). */
  labelledBy?: string;
  describedBy?: string;
}) {
  const t = useT();
  const copy = async () => {
    try {
      if (secret) {
        await copySecret(value);
        toast.ok(t("clipboard.copiedSecret"));
      } else {
        await clip.write(value);
      }
    } catch (e) {
      toast.fail({ title: t("copyField.failed"), detail: e });
      throw e;
    }
  };
  return (
    <Input
      readOnly
      label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={mono ? "mono" : undefined}
      inputSize="xsmall"
      type={secret ? "password" : "text"}
      secret={secret}
      value={value}
      rightIcon={<CopyButton size="3xsmall" className="pointer-events-auto" onCopy={copy} />}
    />
  );
}
