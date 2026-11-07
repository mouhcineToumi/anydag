import { useDocFile, type DocFile } from "@/ui/docFile";

/**
 * A quiz's text as its page holds it, and the writes that keep the file in step. The
 * controller is `src/ui/docFile.ts`, which a table's page shares.
 */
export type QuizFile = DocFile;

export const useQuizFile = (name: string): QuizFile => useDocFile("quiz", name);
