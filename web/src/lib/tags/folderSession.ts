import { DocumentSession } from '@webobsidian/markdown-core';
import { haveNativeFeaturePreferences, readNativeFeatures, tagPreferences } from '../nativeFeaturePreferences';
import { assertTagVaultCurrent } from './api';
import { planFolderTags } from '../../../../server/src/services/tags/folderRules';
import { useStore } from '../store';

/** The existing session remains the sole text/history/save owner. */
export class WorkspaceDocumentSession extends DocumentSession {
  private rejectedVersion = -1;
  override async save(): Promise<void> {
    assertTagVaultCurrent();
    if (!haveNativeFeaturePreferences()) {
      try { await readNativeFeatures(); }
      catch (error) { useStore.getState().notify(`无法读取自动标签设置，本次继续保存原文：${String(error)}`); }
    }
    assertTagVaultCurrent();
    if (this.snapshot.conflict) return super.save();
    const rules = tagPreferences().folderTags;
    if (rules?.enabled) {
      try {
        const plan = planFolderTags(this.snapshot.raw, this.id, rules, this.analysis);
        if (plan.changes.length) this.edit(this.snapshot.version, plan.changes, 'tags.folder-rules');
      } catch (error) {
        // A protected YAML structure must not prevent saving the user's note.
        if (this.rejectedVersion !== this.snapshot.version) {
          this.rejectedVersion = this.snapshot.version;
          useStore.getState().notify(`${this.id}：已跳过自动标签，继续保存原文。${String(error)}`);
        }
      }
    }
    return super.save();
  }
}
