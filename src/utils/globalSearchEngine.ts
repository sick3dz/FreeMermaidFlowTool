import { CallflowGraph, ScriptWorkspace } from '../types/mermaidStudio';
import {
  getModuleOpeningHoursSummary,
  toMermaidNodeSuffix,
} from './scriptCallflowParser';

export type GlobalSearchCategory =
  | 'script'
  | 'dnis'
  | 'queue'
  | 'announcement'
  | 'cdn'
  | 'schedule'
  | 'node';

export interface GlobalSearchEntry {
  id: string;
  category: GlobalSearchCategory;
  title: string;
  subtitle: string;
  meta?: string;
  searchText: string;
  viewKey: string;
  scriptNumber?: string;
  nodeId?: string;
}

export function buildWorkspaceGlobalSearchIndex(
  workspace: ScriptWorkspace | null,
  fallbackGraph?: CallflowGraph | null,
  activeViewKey = 'master'
): GlobalSearchEntry[] {
  const entries: GlobalSearchEntry[] = [];
  const seen = new Set<string>();

  const pushUnique = (entry: GlobalSearchEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    entries.push(entry);
  };

  if (workspace && workspace.modules && workspace.modules.length > 0) {
    workspace.modules.forEach((mod) => {
      const scriptViewKey = `script:${mod.scriptNumber}`;
      const suffix = toMermaidNodeSuffix(mod.scriptNumber);
      const scriptTitle = `${mod.scriptNumber} · ${mod.scriptName || mod.scriptNumber}`;
      const ohSummary = getModuleOpeningHoursSummary(mod, workspace);

      // 1. Script module itself
      pushUnique({
        id: `script:${mod.scriptNumber}`,
        category: 'script',
        title: scriptTitle,
        subtitle: [
          mod.isMaster ? 'Master-Skript' : 'Detail-Skript',
          mod.entryOrganizationName || null,
          `${mod.rules.length} Regeln`,
        ]
          .filter(Boolean)
          .join(' · '),
        meta: ohSummary.combinedBadge || ohSummary.scheduleText || undefined,
        searchText: [
          mod.scriptNumber,
          mod.scriptName,
          mod.cdnAlias,
          mod.entryOrganizationName,
          ...(mod.entryDnisNumbers || []),
          ohSummary.scheduleText,
          ohSummary.holidayText,
          ohSummary.combinedBadge,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        viewKey: scriptViewKey,
        scriptNumber: mod.scriptNumber,
        nodeId: `S_${suffix}`,
      });

      // 2. CDN Alias
      if (mod.cdnAlias) {
        pushUnique({
          id: `cdn:${mod.scriptNumber}:${mod.cdnAlias}`,
          category: 'cdn',
          title: `CDN ${mod.cdnAlias}`,
          subtitle: scriptTitle,
          meta: mod.entryOrganizationName || undefined,
          searchText: `cdn ${mod.cdnAlias} ${mod.scriptNumber} ${mod.scriptName} ${mod.entryOrganizationName || ''}`.toLowerCase(),
          viewKey: scriptViewKey,
          scriptNumber: mod.scriptNumber,
          nodeId: `S_${suffix}`,
        });
      }

      // 3. Entry DNIS numbers
      (mod.entryDnisNumbers || []).forEach((dnis) => {
        const cleanDnis = String(dnis || '').trim();
        if (!cleanDnis) return;
        pushUnique({
          id: `dnis:${cleanDnis}:${mod.scriptNumber}`,
          category: 'dnis',
          title: cleanDnis,
          subtitle: `Direktruf / DNIS → ${scriptTitle}`,
          meta: mod.entryOrganizationName || undefined,
          searchText: `dnis direktruf nummer ${cleanDnis} ${mod.scriptNumber} ${mod.scriptName} ${mod.entryOrganizationName || ''}`.toLowerCase(),
          viewKey: scriptViewKey,
          scriptNumber: mod.scriptNumber,
          nodeId: `S_${suffix}`,
        });
      });

      // 4. Rules: Queues, Announcements, DNIS values, Schedules
      mod.rules.forEach((rule) => {
        if (rule.queueTarget) {
          pushUnique({
            id: `queue:${rule.queueTarget}:${mod.scriptNumber}`,
            category: 'queue',
            title: rule.queueTarget,
            subtitle: `Queue in ${scriptTitle}`,
            meta: `Prio ${rule.prio}${rule.schedule ? ` · ${rule.schedule}` : ''}`,
            searchText: `queue warteschlange skillset ${rule.queueTarget} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }

        if (rule.announcement) {
          pushUnique({
            id: `ann:${rule.announcement}:${mod.scriptNumber}`,
            category: 'announcement',
            title: rule.announcement,
            subtitle: `Ansage in ${scriptTitle}`,
            meta: `Prio ${rule.prio}`,
            searchText: `ansage announcement audio ${rule.announcement} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }

        (rule.valueNumbers || []).forEach((val) => {
          const cleanVal = String(val || '').trim();
          if (!cleanVal) return;
          pushUnique({
            id: `dnis-rule:${cleanVal}:${mod.scriptNumber}:${rule.targetNumber || ''}`,
            category: 'dnis',
            title: cleanVal,
            subtitle: rule.targetNumber
              ? `DNIS in ${mod.scriptNumber} → Ziel ${rule.targetNumber}`
              : `DNIS in ${scriptTitle}`,
            meta: rule.organizationName || `Prio ${rule.prio}`,
            searchText: `dnis nummer ${cleanVal} ${mod.scriptNumber} ${mod.scriptName} ${rule.targetNumber || ''} ${rule.organizationName || ''}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        });

        if (rule.schedule || rule.holiday) {
          const schedLabel = [rule.schedule, rule.holiday].filter(Boolean).join(' · ');
          pushUnique({
            id: `sched:${mod.scriptNumber}:${schedLabel}`,
            category: 'schedule',
            title: schedLabel,
            subtitle: `Zeitregel in ${scriptTitle}`,
            meta: `Prio ${rule.prio}${rule.queueTarget ? ` → ${rule.queueTarget}` : rule.targetNumber ? ` → ${rule.targetNumber}` : ''}`,
            searchText: `zeit öffnungszeiten feiertag sondzeit ${schedLabel} ${mod.scriptNumber} ${mod.scriptName} ${rule.stepName}`.toLowerCase(),
            viewKey: scriptViewKey,
            scriptNumber: mod.scriptNumber,
          });
        }
      });
    });
  } else if (fallbackGraph && fallbackGraph.nodes.size > 0) {
    fallbackGraph.nodes.forEach((node) => {
      pushUnique({
        id: `node:${activeViewKey}:${node.id}`,
        category: 'node',
        title: node.label,
        subtitle: `Knoten ${node.id} · ${node.inDegree} ein / ${node.outDegree} aus`,
        searchText: `${node.label} ${node.id} ${node.role}`.toLowerCase(),
        viewKey: activeViewKey,
        nodeId: node.id,
      });
    });
  }

  return entries;
}
