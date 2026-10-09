/**
 * EST-02 · Reglas de archivo que el navegador valida ANTES de subir (el servidor las vuelve a aplicar
 * con `mimeForFile` y `MAX_UPLOAD_BYTES` de src/lib/storage, que no se puede importar en el cliente).
 * tests/unit/dicom.test.ts comprueba que ambas listas coincidan.
 */
export const STUDY_MAX_BYTES = 200 * 1024 * 1024;

export const STUDY_EXTENSIONS: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  dcm: 'application/dicom',
  dicom: 'application/dicom',
};
export const STUDY_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,.dcm,.dicom,image/jpeg,image/png,image/webp,application/pdf,application/dicom';
export const STUDY_FORMATS_LABEL = 'JPG · PNG · WEBP · PDF · DICOM';

/** Extensión en minúsculas, o '' si el nombre no tiene. */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : '';
}

/** Nombre sin extensión: 'Rx rodilla.JPG' → 'Rx rodilla'. */
export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

/** Tipo del archivo según su extensión (o el MIME declarado si no trae extensión); null si no se admite. */
export function studyMime(name: string, declared?: string | null): string | null {
  const ext = extOf(name);
  if (ext) return STUDY_EXTENSIONS[ext] ?? null;
  return declared && Object.values(STUDY_EXTENSIONS).includes(declared) ? declared : null;
}

export type StudyKind = 'image' | 'pdf' | 'dicom';
export function kindOf(mime: string): StudyKind {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/dicom') return 'dicom';
  return 'image';
}

/** Etiqueta corta de formato para las tarjetas: JPG, PDF, DICOM… */
export function formatLabel(mime: string, fileName = ''): string {
  if (mime === 'application/dicom') return 'DICOM';
  if (mime === 'application/pdf') return 'PDF';
  const ext = extOf(fileName);
  if (ext && STUDY_EXTENSIONS[ext] === mime) return ext === 'jpeg' ? 'JPG' : ext.toUpperCase();
  return mime === 'image/png' ? 'PNG' : mime === 'image/webp' ? 'WEBP' : 'JPG';
}

/** Mensaje listo para mostrar si el archivo no se puede subir; null si es válido. */
export function fileProblem(file: { name: string; size: number; type?: string }): string | null {
  if (!studyMime(file.name, file.type)) return `Ese tipo de archivo no se admite. Sube ${STUDY_FORMATS_LABEL.replace(/ · /g, ', ')}.`;
  if (file.size <= 0) return 'El archivo está vacío.';
  if (file.size > STUDY_MAX_BYTES) return `El archivo pesa ${(file.size / 1024 / 1024).toFixed(0)} MB y el máximo es ${STUDY_MAX_BYTES / 1024 / 1024} MB.`;
  return null;
}
