export interface PublicAppError {
  code: string;
  message: string;
}

export class AppError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AppError";
    this.code = code;
  }

  public toPublic(): PublicAppError {
    return { code: this.code, message: this.message };
  }
}
