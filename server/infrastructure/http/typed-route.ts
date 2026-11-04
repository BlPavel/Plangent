import type { NextFunction, Request, Response, Router } from 'express';
import type { ApiError, EndpointKey, Endpoints } from '@contracts';

type Keys<Kind extends Endpoints[EndpointKey]['kind']> = {
  [K in EndpointKey]: Endpoints[K]['kind'] extends Kind ? K : never
}[EndpointKey];
export type ContractRequest<K extends EndpointKey> = Request<Endpoints[K]['params'], Endpoints[K]['response'] | ApiError, Endpoints[K]['body'], Endpoints[K]['query']>;
type BaseResponse = Omit<Response, 'json' | 'jsonp' | 'send' | 'status' | 'sendStatus' | 'end' | 'write' | 'writeHead' | 'sendFile' | 'sendfile' | 'download' | 'render' | 'redirect'>;
export type ErrorResponse = Pick<Response, 'headersSent'> & {
  status(code: number): ErrorResponse;
  json(error: ApiError): unknown;
  end(): void;
};
export type JsonResponse<K extends EndpointKey> = BaseResponse & {
  json(body: Endpoints[K]['response'] | ApiError): JsonResponse<K>;
  status(code: number): JsonResponse<K>;
  end(): void;
};
export type JsonHandler<K extends EndpointKey> = (req: ContractRequest<K>, res: JsonResponse<K>, next: NextFunction) => unknown;
type FileResponse = BaseResponse & {
  status(code: number): FileResponse;
  send(bytes: Uint8Array | string): void;
  sendFile(path: string): void;
  json(error: ApiError): void;
  end(): void;
};
type StreamResponse<Event> = BaseResponse & {
  status(code: number): StreamResponse<Event>;
  event(event: Event): boolean;
  json(error: ApiError): void;
  end(): void;
};
type EmptyResponse = BaseResponse & {
  status(code: number): EmptyResponse;
  end(): void;
  json(error: ApiError): void;
};

/** The mount is supplied once; keys always use full paths from the contract. */
export function typedRoutes(router: Router, mount: string) {
  function register(key: EndpointKey, handler: (req: Request, res: Response, next: NextFunction) => unknown) {
    const space = key.indexOf(' '), method = key.slice(0, space).toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const path = key.slice(space + 1);
    if (mount && path !== mount && !path.startsWith(mount + '/')) throw new Error(`Endpoint ${key} is outside ${mount}`);
    router[method](path.slice(mount.length) || '/', (req, res, next) => {
      // Express 4 does not forward rejected handler promises itself.
      try { Promise.resolve(handler(req, res, next)).catch(next); } catch (error) { next(error); }
    });
  }
  return {
    json<K extends Keys<'json'>>(key: K, handler: JsonHandler<K>): void {
      register(key, handler as unknown as (req: Request, res: Response, next: NextFunction) => unknown);
    },
    empty<K extends Keys<'empty'>>(key: K, handler: (req: ContractRequest<K>, res: EmptyResponse, next: NextFunction) => unknown): void {
      register(key, handler as unknown as (req: Request, res: Response, next: NextFunction) => unknown);
    },
    file<K extends Keys<'file'>>(key: K, handler: (req: ContractRequest<K>, res: FileResponse, next: NextFunction) => unknown): void {
      register(key, handler as unknown as (req: Request, res: Response, next: NextFunction) => unknown);
    },
    stream<K extends Keys<'ndjson'>>(key: K, handler: (req: ContractRequest<K>, res: StreamResponse<Endpoints[K]['event']>, next: NextFunction) => unknown): void {
      register(key, (req, res, next) => {
        // Keep Express/Node state on the real response, even for chained calls.
        const stream = new Proxy(res, {
          get(target, property) {
            if (property === 'event') return (event: Endpoints[K]['event']) => target.write(JSON.stringify(event) + '\n');
            if (property === 'status') return (code: number) => { target.status(code); return stream; };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }) as unknown as StreamResponse<Endpoints[K]['event']>;
        return handler(req as unknown as ContractRequest<K>, stream, next);
      });
    },
  };
}
