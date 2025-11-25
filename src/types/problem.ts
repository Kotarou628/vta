// src/types/problem.ts

/** 各ファイル単位の解答データ */
export interface SolutionFile {
  /** ファイル名（例: Main.java, utils.c） */
  filename: string;

  /** 言語（任意: "java" | "c" | "cpp" | "python" など） */
  language?: string;

  /** ファイル内のコード本体 */
  code: string;
}

/** 問題データ構造 */
export interface Problem {
  /** FirestoreドキュメントID */
  id: string;

  /** 問題タイトル */
  title: string;

  /** 問題説明 */
  description: string;

  /** 旧形式（後方互換用）単一ファイルのコード */
  solution_code?: string;

  /** 新形式：複数ファイルでの解答 */
  solution_files?: SolutionFile[];

  /** 並び順（任意） */
  order?: number;

  /** Chat画面の問題一覧に表示するかどうか */
  visibleInChat?: boolean | null;
}
