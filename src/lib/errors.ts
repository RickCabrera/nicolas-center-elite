/** Error de aplicación con código estable y mensaje en español listo para mostrar al usuario. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'bad_request', message, fields);
export const unauthorized = (message = 'Inicia sesión para continuar.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'No tienes permiso para hacer esto.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'No encontrado.') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
