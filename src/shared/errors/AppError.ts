export interface PublicAppError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  retryable: boolean;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly fieldErrors: Record<string, string[]> | undefined;
  public readonly retryable: boolean;

  public constructor(code: string, message: string, cause?: unknown, options: { fieldErrors?: Record<string, string[]>; retryable?: boolean } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AppError";
    this.code = code;
    this.fieldErrors = options.fieldErrors;
    this.retryable = options.retryable ?? false;
  }

  public toPublic(): PublicAppError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fieldErrors === undefined ? {} : { fieldErrors: this.fieldErrors }),
      retryable: this.retryable,
    };
  }
}
