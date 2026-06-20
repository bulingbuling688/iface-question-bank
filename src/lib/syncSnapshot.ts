import type { AISession } from '@/store/useAIStore'
import {
  bulkPutQuestionAnswerAnnotations,
  bulkPutQuestionAnswerOverrides,
  bulkPutQuestionFlags,
  bulkPutQuestionNotes,
  bulkPutQuestions,
  bulkPutStudyRecords,
  type CategoryMap,
  DEFAULT_CATEGORY_MAP,
  getAllQuestionAnswerAnnotations,
  getAllQuestionAnswerOverrides,
  getAllQuestionFlags,
  getAllQuestionNotes,
  getAllQuestions,
  getAllStudyRecords,
  getCategoryMap,
  getCustomSources,
  META_KEYS,
  saveCategoryMap,
  setMeta,
} from './db'
import type { SyncData, SyncMergeStats, SyncResult } from './gistSync'

export async function collectLocalSyncData(aiSessions: AISession[]): Promise<SyncData> {
  const [
    studyRecords,
    questionNotes,
    questionAnswerAnnotations,
    questionAnswerOverrides,
    questionFlags,
    allQuestions,
    customSources,
    categoryMap,
  ] = await Promise.all([
    getAllStudyRecords(),
    getAllQuestionNotes(),
    getAllQuestionAnswerAnnotations(),
    getAllQuestionAnswerOverrides(),
    getAllQuestionFlags(),
    getAllQuestions(),
    getCustomSources(),
    getCategoryMap(),
  ])

  const customQuestions = allQuestions.filter(
    (q) => typeof q.id === 'string' && q.id.startsWith('custom_'),
  )
  const customCategories: CategoryMap = {}
  for (const [key, entry] of Object.entries(categoryMap)) {
    if (!entry.builtin) customCategories[key] = entry
  }

  return {
    studyRecords,
    questionNotes,
    questionAnswerAnnotations,
    questionAnswerOverrides,
    questionFlags,
    aiSessions,
    customQuestions,
    customCategories,
    customSources,
  }
}

export async function applySyncData(backup: SyncData): Promise<void> {
  await Promise.all([
    bulkPutStudyRecords(backup.studyRecords),
    bulkPutQuestionNotes(backup.questionNotes),
    bulkPutQuestionAnswerAnnotations(backup.questionAnswerAnnotations),
    bulkPutQuestionAnswerOverrides(backup.questionAnswerOverrides),
    bulkPutQuestionFlags(backup.questionFlags),
    backup.customQuestions.length > 0
      ? bulkPutQuestions(backup.customQuestions)
      : Promise.resolve(),
    setMeta(META_KEYS.CUSTOM_SOURCES, backup.customSources),
    saveCategoryMap({ ...DEFAULT_CATEGORY_MAP, ...backup.customCategories }),
  ])
}

export function resultFromBackup(
  backup: SyncData,
  exportedAt: string,
  stats?: SyncMergeStats,
): SyncResult {
  return {
    ok: true,
    exportedAt,
    recordCount: backup.studyRecords.length,
    questionCount: backup.customQuestions.length,
    noteCount: backup.questionNotes.length,
    answerAnnotationCount: backup.questionAnswerAnnotations.length,
    answerOverrideCount: backup.questionAnswerOverrides.length,
    questionFlagCount: backup.questionFlags.filter((flag) => flag.starred).length,
    aiSessionCount: backup.aiSessions.length,
    aiSessions: backup.aiSessions,
    mergedRemoteRecordCount: stats?.remoteRecordsApplied,
    mergedRemoteNoteCount: stats?.remoteNotesApplied,
    mergedRemoteAnswerAnnotationCount: stats?.remoteAnswerAnnotationsApplied,
    mergedRemoteAnswerOverrideCount: stats?.remoteAnswerOverridesApplied,
    mergedRemoteQuestionFlagCount: stats?.remoteFlagsApplied,
    mergedRemoteAISessionCount: stats?.remoteAISessionsApplied,
    mergedRemoteQuestionCount: stats?.remoteQuestionsAdded,
    mergedRemoteSourceCount: stats?.remoteSourcesAdded,
    mergedRemoteCategoryCount: stats?.remoteCategoriesAdded,
  }
}
