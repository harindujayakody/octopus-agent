import type { ReactNode } from "react";
import { LabelsProvider } from "@proxyshard/shardx-ui-kit";
import { useT } from "../shared/i18n";

/// The kit's own words (close buttons, empty lists, pagers, the discard
/// question) in the UI language. The tree is rebuilt on a language change
/// (app/index.tsx), so these follow it (WRITE-03).
export function KitLabels({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <LabelsProvider
      labels={{
        close: t("common.close"),
        dismiss: t("kit.dismiss"),
        cancel: t("kit.cancel"),
        remove: t("kit.remove"),
        select: t("kit.select"),
        search: t("kit.search"),
        noResults: t("common.noResults"),
        create: t("kit.create"),
        mixed: t("kit.mixed"),
        breadcrumb: t("kit.breadcrumb"),
        pagination: t("kit.pagination"),
        firstPage: t("kit.firstPage"),
        previousPage: t("kit.previousPage"),
        nextPage: t("kit.nextPage"),
        lastPage: t("kit.lastPage"),
        pageOf: t("kit.pageOf"),
        pageN: t("kit.pageN"),
        dontShowAgain: t("kit.dontShowAgain"),
        keepEditing: t("kit.keepEditing"),
        discard: t("kit.discard"),
        discardTitle: t("kit.discardTitle"),
        discardDescription: t("kit.discardDescription"),
        copy: t("kit.copy"),
        copied: t("kit.copied"),
        copyDetails: t("kit.copyDetails"),
        moreToasts: t("kit.moreToasts"),
      }}
    >
      {children}
    </LabelsProvider>
  );
}
