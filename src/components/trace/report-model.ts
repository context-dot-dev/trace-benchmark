import { humanize } from "@/lib/trace/format";
import type { Cohort, CohortId, ProviderRow, SampleRole, Summary } from "@/lib/trace/types";

import type { SortState } from "./data-table";

export type ReportModel = {
  summary: Summary;
  cohortId: CohortId;
  role: SampleRole;
  /** The cohort as a whole (its last completed run and sampling). */
  cohort: Cohort | undefined;
  /** Whether this run splits new and control pages, as the daily sample does. */
  hasRoles: boolean;
  /** The page set every comparison below the switch reads: the role's group when split, else the cohort. */
  group: Cohort | undefined;
  rows: ProviderRow[];
  categoryName: (id: string) => string;
};

/** The useful score, or the raw page share while the score is withheld, so the column still sorts. */
const usefulForSort = (row: ProviderRow) => row.rate ?? (row.count ? row.success / row.count : null);

export function sortRows(rows: ProviderRow[], sort: SortState) {
  const key = sort.column as keyof ProviderRow;
  const value = (row: ProviderRow) => (sort.column === "rate" ? usefulForSort(row) : (row[key] as number | null));
  return [...rows].sort((a, b) => {
    if (sort.column === "rate" && !!a.accountAffected !== !!b.accountAffected) return a.accountAffected ? 1 : -1;
    if (sort.column === "name") return (sort.ascending ? 1 : -1) * a.name.localeCompare(b.name);
    const left = value(a);
    const right = value(b);
    if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
    if (right === null || right === undefined) return -1;
    return (sort.ascending ? 1 : -1) * (left - right);
  });
}

export function buildModel(summary: Summary, cohortId: CohortId, role: SampleRole, sort: SortState): ReportModel {
  const cohort = summary.cohorts[cohortId];
  const hasRoles = cohortId === "independent" && !!cohort?.lastCompleted?.sampling?.sample_design;
  const group = hasRoles ? summary.cohorts[`${cohortId}:${role}`] : cohort;
  return {
    summary,
    cohortId,
    role,
    cohort,
    hasRoles,
    group,
    rows: sortRows(group?.rows ?? [], sort),
    categoryName: (id) => summary.categories.find((category) => category.id === id)?.label ?? humanize(id),
  };
}

/** Page types with no pages in the selected sample; any of them withholds the equal-weight score. */
export function missingCategories(model: ReportModel) {
  return (model.group?.pageTypes ?? []).filter((type) => Object.values(type.results).every((result) => !result || result.count === 0)).map((type) => model.categoryName(type.id));
}
