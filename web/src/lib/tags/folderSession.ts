import { DocumentSession } from '@webobsidian/markdown-core';
import { haveNativeFeaturePreferences, readNativeFeatures, tagPreferences } from '../nativeFeaturePreferences';
import { planFolderTags } from '../../../../server/src/services/tags/folderRules';

/** The existing session remains the sole text/history/save owner. */
export class WorkspaceDocumentSession extends DocumentSession {
  private rejectedVersion = -1;
  override async save(expectedRaw?: string): Promise<void> {
    // A session registry must be constructible before the workspace store.
    const { assertTagVaultCurrent } = await import('./api');
    const { useStore } = await import('../store');
    assertTagVaultCurrent();
    if (!haveNativeFeaturePreferences()) {
      try { await readNativeFeatures(); }
      catch (error) { useStore.getState().notify(`无法读取自动标签设置，本次继续保存原文：${String(error)}`); }
    }
    assertTagVaultCurrent();
    if (this.snapshot.conflict) return super.save(expectedRaw);
    if (expectedRaw !== undefined && this.snapshot.raw !== expectedRaw) throw new Error('文档在接受后又被编辑；保留草稿，停止本次保存');
    const rules = tagPreferences().folderTags;
    if (rules?.enabled) {
      try {
        const plan = planFolderTags(this.snapshot.raw, this.id, rules, this.analysis);
        if (expectedRaw !== undefined && plan.raw !== expectedRaw) throw new Error('固定标签规则改变了审阅结果，请重新提交候选');
        if (plan.changes.length) this.edit(this.snapshot.version, plan.changes, 'tags.folder-rules');
      } catch (error) {
        if (expectedRaw !== undefined) throw error;
        // A protected YAML structure must not prevent saving the user's note.
        if (this.rejectedVersion !== this.snapshot.version) {
          this.rejectedVersion = this.snapshot.version;
          useStore.getState().notify(`${this.id}：已跳过自动标签，继续保存原文。${String(error)}`);
        }
      }
    }
    return super.save(expectedRaw);
  }
}
