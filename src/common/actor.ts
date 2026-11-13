import { createParamDecorator, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type Role = 'MEMBER' | 'MANAGER' | 'OWNER';

/** Quién hace la petición. Lo escribe el Gateway después de validar el JWT. */
export interface Actor {
  id: string;
  role: Role;
}

const ROLES: readonly Role[] = ['MEMBER', 'MANAGER', 'OWNER'];

/**
 * Lee x-member-id y x-member-role. Si no vienen, la petición no pasó por el Gateway
 * con sesión: se rechaza con 403.
 */
export function actorFromHeaders(headers: Request['headers']): Actor {
  const id = headers['x-member-id'];
  const role = headers['x-member-role'];
  if (typeof id !== 'string' || !id) {
    throw new ForbiddenException('Falta la identidad del usuario (inicia sesión)');
  }
  return {
    id,
    role: typeof role === 'string' && ROLES.includes(role as Role) ? (role as Role) : 'MEMBER',
  };
}

/** Uso: metodo(@CurrentActor() actor: Actor) */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  actorFromHeaders(ctx.switchToHttp().getRequest<Request>().headers),
);
