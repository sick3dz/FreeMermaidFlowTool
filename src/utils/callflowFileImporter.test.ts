import { describe, expect, it } from 'vitest';
import {
  autoResolveConnectedScriptsFromFolder,
  findEntryMainFileInFolderPool,
  importCallflowFile,
  indexScriptFolderFiles,
} from './callflowFileImporter';
import {
  buildScriptWorkspace,
  promoteEntryModuleToMain,
} from './scriptCallflowParser';

function makeVirtualFile(name: string, content: string, folder = 'AvayaExport'): File {
  return {
    name,
    webkitRelativePath: `${folder}/${name}`,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  } as unknown as File;
}

describe('callflowFileImporter — Main-connected folder resolution (skipping legacy Altlasten)', () => {
  it('locates Main/Master entry files cleanly via findEntryMainFileInFolderPool', () => {
    const poolWithMain = indexScriptFolderFiles([
      makeVirtualFile('Altlast_2019.s', 'SECTION Init\nDISCONNECT\n'),
      makeVirtualFile('Main.s', 'SECTION Init\nEXECUTE Sub_Active\n'),
      makeVirtualFile('Sub_Active.s', 'SECTION Init\nQUEUE TO SKILLSET Sales_DE\n'),
    ]);
    expect(findEntryMainFileInFolderPool(poolWithMain)?.filename).toBe('Main.s');

    const poolWithoutMain = indexScriptFolderFiles([
      makeVirtualFile('Vertrieb_A.s', 'SECTION Init\nDISCONNECT\n'),
      makeVirtualFile('Service_B.s', 'SECTION Init\nDISCONNECT\n'),
    ]);
    expect(findEntryMainFileInFolderPool(poolWithoutMain)).toBeNull();
  });

  it('loads only the active Main chain and skips unreferenced legacy scripts so dead Altlast refs produce 0 offen', async () => {
    const mainFile = makeVirtualFile(
      'Main.s',
      `
SECTION Init
  WHERE DNIS EQUALS
    VALUE 491001: EXECUTE Ebene1_Aktiv
  END WHERE
`
    );
    const ebene1File = makeVirtualFile(
      'Ebene1_Aktiv.s',
      `
SECTION Start
  GIVE RAN 1001
  EXECUTE Ebene2_Team
`
    );
    const ebene2File = makeVirtualFile(
      'Ebene2_Team.s',
      `
SECTION Start
  QUEUE TO SKILLSET Sales_DE
  DISCONNECT
`
    );

    // 20 unreferenced legacy scripts containing references to non-existent targets
    const legacyFiles: File[] = [];
    for (let i = 1; i <= 20; i++) {
      legacyFiles.push(
        makeVirtualFile(
          `Altlast_Legacy_${i}.s`,
          `
SECTION Legacy
  EXECUTE Check_Response
  EXECUTE blacklist_vip
  EXECUTE servicenummern
  EXECUTE besetzt
  EXECUTE Totes_AltSkript_${i}
`
        )
      );
    }

    const pool = indexScriptFolderFiles([mainFile, ebene1File, ebene2File, ...legacyFiles]);
    const entry = findEntryMainFileInFolderPool(pool);
    expect(entry?.filename).toBe('Main.s');

    const startRes = await importCallflowFile(entry!.file, { isMasterHint: true });
    const seedModules = promoteEntryModuleToMain(startRes.modules, startRes.modules[0].scriptNumber);

    const progressUpdates: Array<{ loaded: number; total: number }> = [];
    const summary = await autoResolveConnectedScriptsFromFolder(seedModules, pool, {
      masterScriptNumber: 'Main',
      onProgress: (loaded, total) => progressUpdates.push({ loaded, total }),
    });

    expect(summary.mode).toBe('connected');
    expect(progressUpdates.length).toBeGreaterThan(0);
    expect(summary.skippedLegacyFilesCount).toBe(20);
    expect(summary.unusedFolderFiles).toHaveLength(20);

    const ws = buildScriptWorkspace(summary.modules, {
      masterScriptNumber: 'Main',
      treatUnresolvedAsEndpoint: false,
    });

    // Only Main + Ebene1_Aktiv + Ebene2_Team loaded — zero legacy scripts, zero missing targets!
    expect(ws.modules).toHaveLength(3);
    expect(ws.missingTargets).toHaveLength(0);
    expect(ws.openIssueCount).toBe(0);
    const missingChecklist = (ws.masterChecklist || []).filter((c) => c.status === 'missing');
    expect(missingChecklist).toHaveLength(0);
  });
});
