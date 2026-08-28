export interface HttpErrorOptions {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly expose?: boolean;
  readonly cause?: unknown;
}

const errorCodePattern = /^[A-Z][A-Z0-9_]*$/;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(options: HttpErrorOptions) {
    if (
      !Number.isInteger(options.statusCode)
      || options.statusCode < 400
      || options.statusCode > 599
    ) {
      throw new RangeError(
        "HTTP error statusCode must be an integer between 400 and 599.",
      );
    }

    if (!errorCodePattern.test(options.code)) {
      throw new TypeError(
        "HTTP error code must contain only uppercase letters, numbers, and underscores.",
      );
    }

    super(
      options.message,
      {
        cause: options.cause,
      },
    );

    this.name = "HttpError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.expose = options.expose
      ?? options.statusCode < 500;
  }
}

export function isHttpError(
  error: unknown,
): error is HttpError {
  return error instanceof HttpError;
}
