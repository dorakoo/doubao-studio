export type CsvDropDecision =
  | { ok: true; file: File }
  | { ok: false; message: string };

/** 拖放入口只接受单个 CSV，防止把目录或混合批次误写入任务库。 */
export function decideCsvDrop(files: FileList | readonly File[]): CsvDropDecision {
  const list = Array.from(files);
  if (list.length !== 1) return { ok: false, message: '请一次只拖入一个 CSV 文件' };
  const file = list[0];
  if (!file.name.toLowerCase().endsWith('.csv')) {
    return { ok: false, message: '仅支持 .csv 任务文件' };
  }
  return { ok: true, file };
}
