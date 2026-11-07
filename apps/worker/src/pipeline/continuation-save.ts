// Compatibility exports for the existing continuation handlers and poller.
export {
  ChapterSourceChanged,
  ChapterWriteAttemptChanged as ContinuationAttemptChanged,
  chapterWriteVersionWhere as continuationVersionWhere,
  lockChapterWriteJob as lockContinuationJob,
  recoverSavedChapterWrite as recoverSavedContinuation
} from "./chapter-save";
