import { useState } from "react";
import { DialogModal, Textarea } from "@proxyshard/shardx-ui-kit";
import { Field } from "../../../shared/ui/Field";
import { toast } from "../../../shared/model/toast";
import { fingerprintImport } from "../../../entities/fingerprint";
import { useT } from "../../../shared/i18n";

export function FingerprintImporter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const save = async () => {
    try {
      const e = await fingerprintImport(text, name || null);
      toast.ok(t("fingerprintImporter.imported", { name: e.label }));
      onClose();
    } catch (e) { toast.fail({ title: t("fingerprintImporter.failed"), detail: e }); }
  };
  return (
    <DialogModal
      open={open}
      onClose={onClose}
      title={t("fingerprintImporter.title")}
      dirty={text.trim() !== "" || name.trim() !== ""}
      confirmLabel={t("fingerprintImporter.confirm")}
      onConfirm={save}
      cancelLabel={t("fingerprintImporter.cancel")}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-3 py-4">
        <Field label={t("fingerprintImporter.nameLabel")} value={name} onChange={setName} placeholder={t("fingerprintImporter.namePlaceholder")} />
        <Textarea
          label={t("fingerprintImporter.jsonLabel")}
          rows={14}
          className="mono w-full"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "name": "...", "navigator": { ... }, "webgl": { ... }, ... }'
        />
      </div>
    </DialogModal>
  );
}
